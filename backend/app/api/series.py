"""/api/v1/series endpoints — Content Series (US1 + US3 + US3b).

- POST   /api/v1/series              create + atomically materialize N posts
- GET    /api/v1/series               list (supports ?include_archived)
- GET    /api/v1/series/{id}          detail with embedded posts
- PATCH  /api/v1/series/{id}          edit title/description only
- DELETE /api/v1/series/{id}          hard delete, rejected if any post is published
- POST   /api/v1/series/{id}/archive    flip series + posts to archived (FR-017)
- POST   /api/v1/series/{id}/unarchive  restore series + posts

All endpoints scoped to the authenticated owner (FR-028).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user_id
from app.api.posts import _raise_platform_gap_conflict
from app.core.database import get_db
from app.core.scheduling import (
    check_platform_gap,
    check_sequential_integrity,
    is_past_est,
    GAP,
)
from app.models.post import Post
from app.models.series import Series
from app.schemas.series import (
    SeriesCreate,
    SeriesResponse,
    SeriesSummary,
    SeriesUpdate,
)

# Fixed stage template — cannot be edited by the user (FR-001).
_STAGE_LABELS = ["Teaser", "Announcement", "Follow-up", "Reminder"]

router = APIRouter(prefix="/series", tags=["series"])


@router.post("", response_model=SeriesResponse, status_code=status.HTTP_201_CREATED)
async def create_series(
    data: SeriesCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    """003 T023: templated 4-stage series create (FR-001..005).

    Validation ordering per contracts/scheduling-invariant.md §"Invariant
    ordering in the templated series-create path":

    1. Pydantic schema validation (422) — covered by SeriesCreate.
    2. Position-vs-label check (422 invalid_stage_order).
    3. Sequential Integrity check (409 sequential_integrity_violation).
    4. Per-stage platform-gap check against existing posts
       (409 platform_gap_conflict + series_post_index).
    5. Pairwise same-platform sibling check across the 4 stages
       (409 platform_gap_conflict + series_post_index = later index).
    6. Atomic insert: 1 Series + 4 Posts, or zero writes on any failure.
    """
    # Step 2: position-vs-label check.
    for i, s in enumerate(data.stages):
        if s.stage != _STAGE_LABELS[i]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "error": "invalid_stage_order",
                    "message": (
                        f"Stage #{i + 1} must be labelled "
                        f"'{_STAGE_LABELS[i]}' (got '{s.stage}')."
                    ),
                    "offending_post_index": i,
                    "expected_stage": _STAGE_LABELS[i],
                },
            )

    times = [s.scheduled_at for s in data.stages]

    # Future-time enforcement: every stage must be scheduled in the future
    # (EST). Rejected with the offending 0-indexed stage so the UI can
    # highlight it.
    for i, t in enumerate(times):
        if is_past_est(t):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "error": "scheduled_at_in_past",
                    "message": (
                        f"Stage #{i + 1} is scheduled in the past. "
                        "Scheduled time must be in the future (EST)."
                    ),
                    "series_post_index": i,
                },
            )

    # Step 3: Sequential Integrity.
    seq = check_sequential_integrity(times)
    if seq is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "sequential_integrity_violation",
                "message": seq.human_message,
                "offending_post_index": seq.offending_index,
                "prior_post_index": seq.prior_index,
                "offending_at": seq.offending_at.isoformat(),
                "prior_at": seq.prior_at.isoformat(),
            },
        )

    # Step 4: per-stage 15-min check against existing non-archived posts.
    for i, s in enumerate(data.stages):
        conflict = await check_platform_gap(
            db,
            owner_id=user_id,
            platform=s.platform,
            scheduled_at=s.scheduled_at,
        )
        if conflict is not None:
            _raise_platform_gap_conflict(conflict, series_post_index=i)

    # Step 5: pairwise same-platform sibling check.
    for i in range(len(data.stages)):
        for j in range(i + 1, len(data.stages)):
            if data.stages[i].platform != data.stages[j].platform:
                continue
            delta = abs((times[j] - times[i]).total_seconds())
            if delta < GAP.total_seconds():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error": "platform_gap_conflict",
                        "message": (
                            f"Stages #{i + 1} and #{j + 1} share platform "
                            f"'{data.stages[i].platform}' and are less than "
                            "15 minutes apart."
                        ),
                        "conflict_with_post_id": None,
                        "conflict_with_scheduled_at": times[i].isoformat(),
                        "delta_minutes": (times[j] - times[i]).total_seconds() / 60.0,
                        "series_post_index": j,
                    },
                )

    # Step 6: atomic write. Legacy cadence columns are set to benign
    # placeholders so 002-era reads continue to work.
    series = Series(
        title=data.title,
        description=data.description,
        platform=data.stages[0].platform,  # display hint only (FR-006)
        start_at=times[0],
        cadence_unit="days",   # placeholder (not user-editable in 003)
        cadence_interval=1,     # placeholder
        post_count=4,
        owner_id=user_id,
        status="active",
    )
    db.add(series)
    await db.flush()

    # 004: resolve family_id. A clone inherits its source's family_id so the
    # UI can group siblings under one card with platform tabs; a fresh series
    # self-references so it's its own singleton family.
    if data.source_series_id is not None:
        src_result = await db.execute(
            select(Series).where(
                Series.id == data.source_series_id,
                Series.owner_id == user_id,
            )
        )
        source = src_result.scalar_one_or_none()
        if source is None:
            # Ownership + existence check. Abort the atomic write.
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": "source_series_not_found",
                    "message": (
                        f"Source series #{data.source_series_id} not found "
                        "or not owned by the current user."
                    ),
                },
            )
        series.family_id = source.family_id or source.id
    else:
        series.family_id = series.id

    for i, s in enumerate(data.stages):
        db.add(
            Post(
                title=s.title,
                platform=s.platform,
                scheduled_at=s.scheduled_at,
                status="scheduled",
                body=s.body,
                stage=s.stage,
                owner_id=user_id,
                series_id=series.id,
                series_position=i,
            )
        )
    await db.commit()

    result = await db.execute(
        select(Series)
        .where(Series.id == series.id)
        .options(selectinload(Series.posts).selectinload(Post.owner))
    )
    return result.scalar_one()


@router.get("", response_model=list[SeriesResponse])
async def list_series(
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
    include_archived: bool = Query(
        False,
        description=(
            "FR-025: when false (default) exclude series with "
            "status='archived'; when true, return archived series too."
        ),
    ),
):
    # Eagerly load posts (+ each post's owner) so the response carries the
    # stages the ListView needs to render in one round-trip.
    q = (
        select(Series)
        .where(Series.owner_id == user_id)
        .options(selectinload(Series.posts).selectinload(Post.owner))
        .order_by(Series.created_at.desc())
    )
    if not include_archived:
        q = q.where(Series.status != "archived")
    result = await db.execute(q)
    return list(result.scalars().all())


async def _load_owned_series(
    db: AsyncSession, series_id: int, user_id: int
) -> Series:
    result = await db.execute(
        select(Series)
        .where(Series.id == series_id, Series.owner_id == user_id)
        .options(selectinload(Series.posts).selectinload(Post.owner))
    )
    series = result.scalar_one_or_none()
    if series is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Series not found")
    return series


@router.get("/{series_id}", response_model=SeriesResponse)
async def get_series(
    series_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    return await _load_owned_series(db, series_id, user_id)


@router.patch("/{series_id}", response_model=SeriesResponse)
async def update_series(
    series_id: int,
    data: SeriesUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    series = await _load_owned_series(db, series_id, user_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(series, k, v)
    await db.commit()
    await db.refresh(series)
    return await _load_owned_series(db, series_id, user_id)


@router.delete("/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_series(
    series_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    """FR-016: reject when any child post is published. User must Archive."""
    series = await _load_owned_series(db, series_id, user_id)
    if any(p.status == "published" for p in series.posts):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "series_has_published_posts",
                "message": (
                    "Series has one or more published posts and cannot be "
                    "deleted. Archive the series instead to preserve history."
                ),
            },
        )
    await db.delete(series)
    await db.commit()


@router.post("/{series_id}/archive", response_model=SeriesResponse)
async def archive_series(
    series_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    """FR-017: cascade-archive. Flip `series.status = archived`; flip every
    non-archived child post to status='archived' and set its
    previous_status. Posts already archived are left untouched to preserve
    the no-stacking invariant (data-model §6)."""
    series = await _load_owned_series(db, series_id, user_id)
    if series.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "already_archived",
                "message": "Series is already archived.",
            },
        )
    series.previous_status = "active"
    series.status = "archived"
    for p in series.posts:
        if p.status != "archived":
            p.previous_status = p.status
            p.status = "archived"
    await db.commit()
    return await _load_owned_series(db, series_id, user_id)


@router.post("/{series_id}/unarchive", response_model=SeriesResponse)
async def unarchive_series(
    series_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    """Restore the series and every child post that was archived as
    part of this series-level archive.

    Series itself goes back to `active`. Child posts that were carried
    in by the cascade (`previous_status` populated) ALWAYS land in
    `draft` — never the previous status — so unarchiving cannot
    silently re-arm the auto-publish loop on posts the user had
    explicitly removed from the schedule. `previous_status` is cleared.
    `scheduled_at` is preserved so the user can edit + re-schedule
    without re-typing the time. Posts that were individually archived
    earlier (NULL `previous_status`) are not touched by series
    unarchive — they stay archived and need their own /unarchive call.
    """
    series = await _load_owned_series(db, series_id, user_id)
    if series.status != "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "not_archived",
                "message": "Series is not archived.",
            },
        )
    series.status = series.previous_status or "active"
    series.previous_status = None
    for p in series.posts:
        if p.status == "archived" and p.previous_status:
            p.status = "draft"
            p.previous_status = None
    await db.commit()
    return await _load_owned_series(db, series_id, user_id)
