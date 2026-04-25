"""Auto-publish polling loop (feature 006).

Stdlib-only `asyncio` polling that wakes every TICK_INTERVAL_SECONDS,
finds posts whose `status='scheduled'` and `scheduled_at` is past the
current EST wall-clock, and transitions them to `published`.

Designed to be in-process (Constitution Principle II — no APScheduler,
no external queue). The implementation deliberately mirrors the
reference skeleton on the abandoned `005-auto-publish-scheduled` branch
but drops the SSE / event-fanout layer (Q4 — polling is the chosen
freshness mechanism).

Public surface:
    tick_once(now=...) -> dict        # one polling iteration
    publish_post_manually(db, post)   # bypass sequential rule (FR-015a)
    start_publisher(app)              # spawn background loop
    stop_publisher()                  # cancel + await background loop

Failure-annotation contract: see specs/006-auto-publish-flow/data-model.md
section "`last_publish_error` value contract".
"""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime
from typing import Optional

from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.scheduling import EST, is_past_est
from app.models.post import Post, PostStatus

logger = logging.getLogger(__name__)

TICK_INTERVAL_SECONDS = 15

MAX_ATTEMPTS = 3
_BACKOFF_SECONDS: tuple[float, float, float] = (1.0, 2.0, 4.0)

ERR_TRANSIENT_DB = "transient_database_error"
ERR_PREDECESSOR = "predecessor_not_published"
ERR_UNKNOWN = "unknown_internal_error"

_publisher_task: Optional[asyncio.Task] = None


def _is_due(scheduled_at: Optional[datetime], now: datetime) -> bool:
    return is_past_est(scheduled_at, now=now)


def _apply_published(post: Post) -> None:
    """Single source of truth for the field flips that mark a post
    `published` and clear any prior failure annotation. Used by both
    auto-publish (`_flush_publish`) and manual publish."""
    post.status = PostStatus.PUBLISHED.value
    post.last_publish_attempt_at = None
    post.last_publish_error = None


async def _flush_publish(db: AsyncSession, post: Post) -> None:
    """Single DB write that flips a post to `published`. Patch point for
    tests that simulate transient DB failures (see test_publisher.py)."""
    _apply_published(post)
    await db.commit()


async def _check_predecessor_published(db: AsyncSession, post: Post) -> bool:
    """FR-009a — only allow auto-publish when the immediate predecessor
    stage in the same series is `published`. Returns True for non-series
    posts and for `series_position=0` (no predecessor)."""
    if (
        post.series_id is None
        or post.series_position is None
        or post.series_position == 0
    ):
        return True
    result = await db.execute(
        select(Post).where(
            Post.series_id == post.series_id,
            Post.series_position == post.series_position - 1,
        )
    )
    pred = result.scalar_one_or_none()
    return pred is not None and pred.status == PostStatus.PUBLISHED.value


async def _annotate_in(db: AsyncSession, post_id: int, code: str) -> None:
    """Persist a failure annotation via a direct UPDATE statement.

    Uses Core-level `update()` (no ORM lazy-load) so it works correctly
    after a session rollback when ORM identity-map state is stale.
    """
    await db.execute(
        update(Post)
        .where(Post.id == post_id)
        .values(
            last_publish_attempt_at=datetime.now(EST),
            last_publish_error=code,
        )
    )
    await db.commit()


async def _process_post(
    post_id: int,
    *,
    now: datetime,
    summary: dict,
    visited: set,
) -> Optional[tuple[int, int]]:
    """Process a single candidate inside one session. Returns
    `(series_id, series_position)` when a successful publish should
    cascade to a successor (FR-009b); otherwise None.
    Cascade processing is done by the caller AFTER this session closes.
    """
    if post_id in visited:
        return None
    visited.add(post_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Post).where(Post.id == post_id))
        post = result.scalar_one_or_none()
        if post is None:
            logger.info(
                "post id=%s vanished between candidate-query and publish; skipping",
                post_id,
            )
            return None
        if post.status != PostStatus.SCHEDULED.value:
            return None
        if not _is_due(post.scheduled_at, now):
            return None

        # Snapshot all attributes we'll need AFTER any rollback. After
        # `db.rollback()` the ORM expires `post` and accessing any field
        # would trigger a sync re-load that crashes the async greenlet.
        snapshot_series_id = post.series_id
        snapshot_series_position = post.series_position
        snapshot_scheduled_at = post.scheduled_at

        # FR-009a — predecessor check
        ok = await _check_predecessor_published(db, post)
        if not ok:
            logger.info(
                "post id=%s skipped — series predecessor not yet published",
                post_id,
            )
            await db.rollback()
            await _annotate_in(db, post_id, ERR_PREDECESSOR)
            summary["skipped_predecessor"] += 1
            return None

        # In-tick retry loop (FR-007a) — keep _flush_publish as the patch point.
        last_err: Optional[BaseException] = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                await _flush_publish(db, post)
                logger.info(
                    "auto-published post id=%s scheduled_at=%s attempts=%d",
                    post_id,
                    snapshot_scheduled_at,
                    attempt + 1,
                )
                summary["published"] += 1
                if snapshot_series_id is not None and snapshot_series_position is not None:
                    return (snapshot_series_id, snapshot_series_position)
                return None
            except BaseException as e:  # noqa: BLE001 — re-raised via annotation
                last_err = e
                logger.warning(
                    "publish attempt %d/%d failed for post id=%s: %s",
                    attempt + 1,
                    MAX_ATTEMPTS,
                    post_id,
                    e,
                )
                try:
                    await db.rollback()
                except Exception:
                    pass
                if attempt < MAX_ATTEMPTS - 1:
                    await asyncio.sleep(_BACKOFF_SECONDS[attempt])

        # All attempts exhausted.
        logger.error(
            "publish exhausted %d retries for post id=%s: %s",
            MAX_ATTEMPTS,
            post_id,
            last_err,
        )
        await _annotate_in(db, post_id, ERR_TRANSIENT_DB)
        summary["failed"] += 1
        return None


async def tick_once(*, now: Optional[datetime] = None) -> dict:
    """One polling iteration. Returns a summary dict for logging/tests.

    `now` is injected for testability; production callers omit it and
    the function uses `datetime.now(EST)`.
    """
    if now is None:
        now = datetime.now(EST)
    summary = {
        "published": 0,
        "skipped_predecessor": 0,
        "failed": 0,
    }

    candidate_ids: list[int] = []
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Post)
            .where(
                Post.status == PostStatus.SCHEDULED.value,
                Post.scheduled_at.is_not(None),
            )
            .order_by(Post.scheduled_at)
        )
        for p in result.scalars().all():
            if _is_due(p.scheduled_at, now):
                candidate_ids.append(p.id)

    visited: set[int] = set()
    queue: deque[int] = deque(candidate_ids)
    while queue:
        pid = queue.popleft()
        try:
            cascade = await _process_post(
                pid, now=now, summary=summary, visited=visited
            )
        except Exception as e:
            logger.exception(
                "unexpected error while processing post id=%s: %s", pid, e
            )
            try:
                async with AsyncSessionLocal() as fresh:
                    await _annotate_in(fresh, pid, ERR_UNKNOWN)
            except Exception:
                logger.exception("annotation also failed for post id=%s", pid)
            continue

        # FR-009b — cascade to immediate successor in same series if its
        # scheduled_at is also due. Done OUTSIDE the previous session.
        if cascade is not None:
            series_id, series_position = cascade
            async with AsyncSessionLocal() as db2:
                succ = (
                    await db2.execute(
                        select(Post).where(
                            Post.series_id == series_id,
                            Post.series_position == series_position + 1,
                            Post.status == PostStatus.SCHEDULED.value,
                        )
                    )
                ).scalar_one_or_none()
                if succ is not None and _is_due(succ.scheduled_at, now):
                    queue.append(succ.id)

    return summary


async def publish_post_manually(db: AsyncSession, post: Post) -> Post:
    """FR-015 / FR-015a — manual publish via the API endpoint.

    Bypasses the sequential predecessor rule (manual publish reflects
    deliberate human intent). The caller's session is mutated and
    committed in-place; the refreshed post is returned. The post's
    annotation columns are cleared on success.
    """
    _apply_published(post)
    await db.commit()
    await db.refresh(post)
    logger.info("manually published post id=%s", post.id)
    return post


async def _publisher_loop() -> None:
    """Background loop. Runs forever until cancelled."""
    logger.info("publisher loop starting (tick=%ds)", TICK_INTERVAL_SECONDS)
    while True:
        try:
            summary = await tick_once()
            if summary["published"] or summary["skipped_predecessor"] or summary["failed"]:
                logger.info("publisher tick: %s", summary)
        except asyncio.CancelledError:
            logger.info("publisher loop cancelled")
            raise
        except Exception:
            logger.exception("publisher tick raised unexpectedly")
        await asyncio.sleep(TICK_INTERVAL_SECONDS)


def start_publisher(app: FastAPI) -> None:
    """Spawn the background loop. Called from FastAPI's lifespan."""
    global _publisher_task
    if _publisher_task is not None and not _publisher_task.done():
        return
    _publisher_task = asyncio.create_task(_publisher_loop())


async def stop_publisher() -> None:
    """Cancel the background loop and await its termination."""
    global _publisher_task
    if _publisher_task is None:
        return
    _publisher_task.cancel()
    try:
        await _publisher_task
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("publisher loop raised during shutdown")
    _publisher_task = None
