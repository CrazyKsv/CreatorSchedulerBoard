"""/api/v1/stats — aggregated counts for the dashboard.

The frontend used to compute every counter locally (filtering the full
post + series list in the browser). This endpoint moves that aggregation
to the backend so the dashboard can render reliable counts without
depending on whether the client has paginated / filtered data loaded.

Returned counters mirror the DashboardHero fields:
  - scheduled_count      : posts with status='scheduled' (non-archived)
  - drafts_count         : posts with status='draft' (non-archived)
  - published_last_7d    : posts with status='published' updated in the
                            last 7 days
  - series_active_count  : non-archived series owned by the user
  - conflicts_count      : pairs of non-archived posts on the same
                            platform within 15 min of each other
                            (counted as posts involved in a conflict)
  - upcoming_7d          : scheduled posts whose scheduled_at falls in
                            the next 7 days
  - posts_total          : non-archived posts (all statuses)
  - by_platform          : {platform: count} of non-archived posts
"""
import asyncio
from datetime import datetime, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.core.database import get_db
from app.core.scheduling import GAP, now_est_naive
from app.models.post import Post
from app.models.series import Series

router = APIRouter(prefix="/stats", tags=["stats"])


def _count_conflicts(posts: list[Post]) -> int:
    """Posts within 15 minutes of another same-platform sibling — both
    sides of every conflicting pair are counted (matches the badge logic
    on the dashboard which highlights both posts).
    """
    by_pl: dict[str, list[Post]] = {}
    for p in posts:
        if p.scheduled_at is None or p.platform is None:
            continue
        by_pl.setdefault(p.platform, []).append(p)
    flagged: set[int] = set()
    for items in by_pl.values():
        items.sort(key=lambda p: p.scheduled_at)
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                delta = (items[j].scheduled_at - items[i].scheduled_at).total_seconds()
                if delta >= GAP.total_seconds():
                    break
                flagged.add(items[i].id)
                flagged.add(items[j].id)
    return len(flagged)


@router.get("/dashboard")
async def dashboard_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    now = now_est_naive()
    week_ago = now - timedelta(days=7)
    week_ahead = now + timedelta(days=7)

    # Run the two independent reads in parallel — they share no state.
    posts_result, series_result = await asyncio.gather(
        db.execute(
            select(Post).where(Post.owner_id == user_id, Post.status != "archived")
        ),
        db.execute(
            select(Series).where(Series.owner_id == user_id, Series.status != "archived")
        ),
    )
    posts = list(posts_result.scalars().all())
    series_list = list(series_result.scalars().all())

    scheduled = [p for p in posts if p.status == "scheduled"]
    drafts = [p for p in posts if p.status == "draft"]
    published_recent = [
        p for p in posts
        if p.status == "published"
        and p.updated_at is not None
        and p.updated_at >= week_ago
    ]
    upcoming_7d = [
        p for p in scheduled
        if p.scheduled_at is not None and now <= p.scheduled_at <= week_ahead
    ]

    by_platform: dict[str, int] = {}
    for p in posts:
        if p.platform:
            by_platform[p.platform] = by_platform.get(p.platform, 0) + 1

    return {
        "scheduled_count": len(scheduled),
        "drafts_count": len(drafts),
        "published_last_7d": len(published_recent),
        "series_active_count": len(series_list),
        "conflicts_count": _count_conflicts(posts),
        "upcoming_7d": len(upcoming_7d),
        "posts_total": len(posts),
        "by_platform": by_platform,
        "generated_at": now.isoformat(),
    }


@router.get("/upcoming")
async def upcoming_posts(
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
    start: Optional[datetime] = Query(None, description="ISO start (default = now)"),
    end: Optional[datetime] = Query(None, description="ISO end (default = +7 days)"),
):
    """Lightweight summary of posts in a time window (used by the agent
    to answer "how many upcoming posts do I have this week?")."""
    now = now_est_naive()
    s = start or now
    e = end or (now + timedelta(days=7))

    q = await db.execute(
        select(Post).where(
            Post.owner_id == user_id,
            Post.status != "archived",
            Post.scheduled_at.is_not(None),
            Post.scheduled_at >= s,
            Post.scheduled_at <= e,
        ).order_by(Post.scheduled_at.asc())
    )
    items = list(q.scalars().all())
    by_pl: dict[str, int] = {}
    for p in items:
        by_pl[p.platform] = by_pl.get(p.platform, 0) + 1
    return {
        "range_start": s.isoformat(),
        "range_end": e.isoformat(),
        "count": len(items),
        "by_platform": by_pl,
        "items": [
            {
                "id": p.id,
                "title": p.title,
                "platform": p.platform,
                "scheduled_at": p.scheduled_at.isoformat() if p.scheduled_at else None,
                "status": p.status,
                "series_id": p.series_id,
            }
            for p in items
        ],
    }
