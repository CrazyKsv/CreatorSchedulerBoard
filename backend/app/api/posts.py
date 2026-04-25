from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user_id
from app.core.database import get_db
from app.core.publisher import publish_post_manually
from app.core.scheduling import (
    Conflict,
    check_platform_gap,
    check_sequential_integrity,
    is_past_est,
)
from app.models.post import Post
from app.schemas.post import PostCreate, PostUpdate, PostResponse

router = APIRouter(prefix="/posts", tags=["posts"])


def _raise_platform_gap_conflict(
    conflict: Conflict, series_post_index: Optional[int] = None
) -> None:
    """Shared 409 factory. Same body shape for single-post and series-create
    paths (FR-011 amendment, Principle X). When called from series-create,
    `series_post_index` is the 0-indexed position of the offending
    generated post; omitted otherwise.
    """
    detail = {
        "error": "platform_gap_conflict",
        "message": conflict.human_message,
        "conflict_with_post_id": conflict.other_post_id,
        "conflict_with_scheduled_at": conflict.other_scheduled_at.isoformat(),
        "delta_minutes": conflict.delta_minutes,
    }
    if series_post_index is not None:
        detail["series_post_index"] = series_post_index
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def _load_owned_post(
    db: AsyncSession, post_id: int, user_id: int
) -> Post:
    """Load a post scoped to the authenticated owner or raise 404.

    FR-028: ownership scoping. Returning 404 (not 403) prevents ID
    enumeration from leaking the existence of other users' posts.
    Eagerly loads `owner` so PostResponse's derived `author` field
    serializes cleanly under async.
    """
    result = await db.execute(
        select(Post)
        .where(Post.id == post_id, Post.owner_id == user_id)
        .options(selectinload(Post.owner))
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    return post


@router.get("", response_model=list[PostResponse])
async def list_posts(
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
    status: Optional[str] = Query(None, description="Filter by status"),
    platform: Optional[str] = Query(None, description="Filter by platform"),
    include_archived: bool = Query(
        False,
        description=(
            "FR-025: when false (default) exclude posts with status='archived'; "
            "when true, return archived posts in the response."
        ),
    ),
):
    q = (
        select(Post)
        .where(Post.owner_id == user_id)
        .options(selectinload(Post.owner))
        .order_by(Post.scheduled_at.desc().nulls_last(), Post.created_at.desc())
    )
    if status:
        q = q.where(Post.status == status)
    if platform:
        q = q.where(Post.platform == platform)
    if not include_archived:
        q = q.where(Post.status != "archived")
    result = await db.execute(q)
    return list(result.scalars().all())


@router.post("", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
async def create_post(
    data: PostCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    if is_past_est(data.scheduled_at):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "scheduled_at_in_past",
                "message": "Scheduled time must be in the future (EST).",
            },
        )
    conflict = await check_platform_gap(
        db,
        owner_id=user_id,
        platform=data.platform,
        scheduled_at=data.scheduled_at,
    )
    if conflict is not None:
        _raise_platform_gap_conflict(conflict)

    post = Post(
        title=data.title,
        platform=data.platform,
        scheduled_at=data.scheduled_at,
        status=data.status,
        body=data.body,
        owner_id=user_id,
    )
    db.add(post)
    await db.commit()
    # Reload with owner eagerly loaded for the response (FR-009 derived author).
    return await _load_owned_post(db, post.id, user_id)


@router.get("/{post_id}", response_model=PostResponse)
async def get_post(
    post_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    return await _load_owned_post(db, post_id, user_id)


async def _check_series_post_sequential_integrity(
    db: AsyncSession, post: Post, new_scheduled_at
) -> None:
    """FR-020: when a series-child post's scheduled_at changes, re-validate
    the series' Sequential Integrity by substituting the new time into
    the ordered sibling list. No-op for standalone posts (series_id IS NULL).
    """
    if post.series_id is None or new_scheduled_at is None:
        return

    # Load all siblings ordered by series_position.
    result = await db.execute(
        select(Post)
        .where(Post.series_id == post.series_id)
        .order_by(Post.series_position)
    )
    siblings = list(result.scalars().all())
    times = []
    for sib in siblings:
        if sib.id == post.id:
            times.append(new_scheduled_at)
        else:
            times.append(sib.scheduled_at)
    seq = check_sequential_integrity(times)
    if seq is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "sequential_integrity_violation",
                "message": seq.human_message,
                "offending_post_index": seq.offending_index,
                "prior_post_index": seq.prior_index,
                "offending_at": seq.offending_at.isoformat() if seq.offending_at else None,
                "prior_at": seq.prior_at.isoformat() if seq.prior_at else None,
            },
        )


@router.patch("/{post_id}", response_model=PostResponse)
async def update_post(
    post_id: int,
    data: PostUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    post = await _load_owned_post(db, post_id, user_id)
    patch = data.model_dump(exclude_unset=True)

    # 003 FR-010: platform change on series post is ALLOWED (002 FR-005b
    # relaxed; the 15-min invariant is the protection — re-run below).

    # FR-018 + FR-019 + FR-020: when scheduled_at or platform is in the
    # patch, re-check the 15-min invariant (archive-excluded) AND, if this
    # is a series-child post with a time change, re-check Sequential
    # Integrity against its siblings.
    if "scheduled_at" in patch or "platform" in patch:
        effective_platform = patch.get("platform", post.platform)
        effective_scheduled_at = patch.get("scheduled_at", post.scheduled_at)
        if "scheduled_at" in patch and is_past_est(effective_scheduled_at):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "error": "scheduled_at_in_past",
                    "message": "Scheduled time must be in the future (EST).",
                },
            )
        conflict = await check_platform_gap(
            db,
            owner_id=user_id,
            platform=effective_platform,
            scheduled_at=effective_scheduled_at,
            exclude_post_id=post.id,
        )
        if conflict is not None:
            _raise_platform_gap_conflict(conflict)
        if "scheduled_at" in patch:
            await _check_series_post_sequential_integrity(
                db, post, effective_scheduled_at
            )

    for k, v in patch.items():
        setattr(post, k, v)
    await db.commit()
    return await _load_owned_post(db, post.id, user_id)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    post = await _load_owned_post(db, post_id, user_id)
    # FR-014: published posts cannot be hard-deleted. The client must
    # Archive them instead (archival preserves history).
    if post.status == "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "published_requires_archive",
                "message": (
                    "Published posts cannot be deleted. "
                    "Archive the post instead to preserve history."
                ),
            },
        )
    await db.delete(post)
    await db.commit()


@router.post("/{post_id}/archive", response_model=PostResponse)
async def archive_post(
    post_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    """FR-015: flip status -> archived while preserving previous_status."""
    post = await _load_owned_post(db, post_id, user_id)
    if post.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "already_archived",
                "message": "Post is already archived.",
            },
        )
    post.previous_status = post.status
    post.status = "archived"
    await db.commit()
    return await _load_owned_post(db, post.id, user_id)


@router.post("/{post_id}/publish", response_model=PostResponse)
async def publish_post(
    post_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    """FR-015 — manual publish on user request. Bypasses the series
    sequential predecessor rule (FR-015a) so a creator can publish a
    stage immediately even if its predecessor isn't published yet.

    Returns 409 when the source status is `archived`, `failed`, or
    already `published`. Allowed source statuses: `draft`, `scheduled`.
    """
    post = await _load_owned_post(db, post_id, user_id)
    if post.status == "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "already_published",
                "message": f"Post {post_id} is already published.",
            },
        )
    if post.status in ("archived", "failed"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "publish_not_allowed",
                "message": f'Cannot publish a post in status "{post.status}".',
                "current_status": post.status,
            },
        )
    # status is draft or scheduled — flip to published, clear annotation.
    await publish_post_manually(db, post)
    return await _load_owned_post(db, post.id, user_id)


@router.post("/{post_id}/unarchive", response_model=PostResponse)
async def unarchive_post(
    post_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    """Unarchive a post — always restore to `draft`.

    Previous behavior restored `previous_status` (e.g., scheduled), which
    risked silently re-arming the auto-publish loop on a post the user
    had explicitly removed from the schedule. The current contract is
    deliberately conservative: every unarchive lands the post in `draft`
    so the user has to re-confirm the schedule (status → scheduled) by
    editing the post. `scheduled_at` is preserved so they don't lose
    the original time. `previous_status` is cleared to keep the row
    canonically clean.
    """
    post = await _load_owned_post(db, post_id, user_id)
    if post.status != "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "not_archived",
                "message": "Post is not archived.",
            },
        )
    post.status = "draft"
    post.previous_status = None
    await db.commit()
    return await _load_owned_post(db, post.id, user_id)
