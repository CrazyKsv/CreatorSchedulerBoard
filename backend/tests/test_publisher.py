"""Tests for the auto-publish polling loop (feature 006).

Test-First per constitution Principle IX — these are authored before
`backend/app/core/publisher.py` exists. They fail on import until that
module lands; once it does, they MUST pass.

Covers FR-001 / FR-003 / FR-005 / FR-009 / FR-009a / FR-009b / FR-007a /
FR-007b and the matching SCs. See specs/006-auto-publish-flow/tasks.md
T005-T013a.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core import publisher  # noqa: F401 — module must exist
from app.models.post import Post, PostStatus
from app.models.series import Series
from app.models.user import User
from app.core.security import get_password_hash


# ─────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────


def _utc(year, month, day, hour=12, minute=0):
    """Return a naive datetime treated as an EST wall-clock per project
    convention (see scheduling.is_past_est). The publisher's `_to_est`
    interprets naive datetimes as EST, and SQLite stores all datetimes
    as naive — so building these naive keeps the test's in-memory
    `now` and the round-tripped DB `scheduled_at` in the same frame.
    """
    return datetime(year, month, day, hour, minute)


async def _seed_user(email: str = "alice@test.com") -> User:
    async with AsyncSessionLocal() as db:
        u = User(email=email, hashed_password=get_password_hash("pw"), full_name="Alice")
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


async def _seed_post(
    *,
    owner_id: int,
    scheduled_at: datetime | None,
    status: str = "scheduled",
    series_id: int | None = None,
    series_position: int | None = None,
    title: str = "Post",
    platform: str = "instagram",
) -> Post:
    async with AsyncSessionLocal() as db:
        p = Post(
            title=title,
            platform=platform,
            scheduled_at=scheduled_at,
            status=status,
            owner_id=owner_id,
            series_id=series_id,
            series_position=series_position,
        )
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return p


async def _seed_series(*, owner_id: int, title: str = "Drop") -> Series:
    async with AsyncSessionLocal() as db:
        s = Series(
            title=title,
            description=None,
            platform="instagram",
            owner_id=owner_id,
            start_at=_utc(2026, 1, 1),
            cadence_unit="days",
            cadence_interval=1,
            post_count=4,
        )
        db.add(s)
        await db.flush()
        s.family_id = s.id
        await db.commit()
        await db.refresh(s)
        return s


async def _get_post(post_id: int) -> Post:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Post).where(Post.id == post_id))
        return result.scalar_one()


async def _run_tick(now: datetime):
    """Drive a single publisher iteration with an injected `now`."""
    return await publisher.tick_once(now=now)


# ─────────────────────────────────────────────────────────────────────────
# Tests (T006 — T013a)
# ─────────────────────────────────────────────────────────────────────────


# T006
@pytest.mark.asyncio
async def test_tick_publishes_due_scheduled_post():
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    p = await _seed_post(
        owner_id=user.id, scheduled_at=now - timedelta(seconds=1), status="scheduled"
    )

    summary = await _run_tick(now=now)

    after = await _get_post(p.id)
    assert after.status == "published"
    assert after.last_publish_attempt_at is None
    assert after.last_publish_error is None
    assert summary["published"] >= 1


# T007
@pytest.mark.asyncio
async def test_tick_does_not_publish_future_post():
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    p = await _seed_post(
        owner_id=user.id, scheduled_at=now + timedelta(seconds=60), status="scheduled"
    )

    await _run_tick(now=now)

    after = await _get_post(p.id)
    assert after.status == "scheduled"
    assert after.last_publish_attempt_at is None


# T008
@pytest.mark.asyncio
async def test_tick_catchup_after_restart():
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    overdue_times = [now - timedelta(minutes=i) for i in range(1, 4)]
    posts = []
    for i, t in enumerate(overdue_times):
        # Different platforms keep the 15-min gap rule out of this test.
        p = await _seed_post(
            owner_id=user.id, scheduled_at=t, status="scheduled",
            platform=["instagram", "youtube", "tiktok"][i],
            title=f"Catchup post {i}",
        )
        posts.append(p)

    await _run_tick(now=now)

    for p in posts:
        after = await _get_post(p.id)
        assert after.status == "published", f"post {p.id} should have published"


# T009
@pytest.mark.asyncio
async def test_tick_skips_when_predecessor_not_published():
    user = await _seed_user()
    s = await _seed_series(owner_id=user.id)
    now = _utc(2026, 5, 1, 14, 0)
    # stage 1 in the future (still scheduled)
    stage1 = await _seed_post(
        owner_id=user.id, scheduled_at=now + timedelta(hours=1),
        status="scheduled", series_id=s.id, series_position=0,
        title="Teaser",
    )
    # stage 2 due now (its predecessor is not yet published)
    stage2 = await _seed_post(
        owner_id=user.id, scheduled_at=now - timedelta(seconds=1),
        status="scheduled", series_id=s.id, series_position=1,
        title="Announce",
    )

    await _run_tick(now=now)

    after1 = await _get_post(stage1.id)
    after2 = await _get_post(stage2.id)
    assert after1.status == "scheduled"
    assert after2.status == "scheduled"
    assert after2.last_publish_error == publisher.ERR_PREDECESSOR
    assert after2.last_publish_attempt_at is not None


# T010
@pytest.mark.asyncio
async def test_tick_cascades_when_predecessor_unblocks():
    """All 4 stages overdue, all scheduled. One tick must publish stage 0
    then cascade through 1 → 2 → 3 in order (FR-009b)."""
    user = await _seed_user()
    s = await _seed_series(owner_id=user.id)
    now = _utc(2026, 5, 1, 14, 0)
    stages = []
    for i in range(4):
        stages.append(await _seed_post(
            owner_id=user.id, scheduled_at=now - timedelta(minutes=4 - i),
            status="scheduled", series_id=s.id, series_position=i,
            title=f"Stage {i}",
        ))

    await _run_tick(now=now)

    for stg in stages:
        after = await _get_post(stg.id)
        assert after.status == "published", f"stage {stg.series_position} should be published"
        assert after.last_publish_error is None


# T011
@pytest.mark.asyncio
async def test_tick_retry_then_succeed():
    """Patch _flush_publish to fail once then succeed. Post ends up
    published after a single tick; annotation columns are NULL."""
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    p = await _seed_post(
        owner_id=user.id, scheduled_at=now - timedelta(seconds=1), status="scheduled"
    )

    real_flush = publisher._flush_publish
    call_count = {"n": 0}

    async def fake_flush(db, post):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("simulated transient")
        return await real_flush(db, post)

    with patch.object(publisher, "_flush_publish", side_effect=fake_flush), \
         patch.object(publisher, "_BACKOFF_SECONDS", (0.0, 0.0, 0.0)):
        await _run_tick(now=now)

    after = await _get_post(p.id)
    assert after.status == "published"
    assert after.last_publish_attempt_at is None
    assert after.last_publish_error is None
    assert call_count["n"] == 2  # 1 fail + 1 success


# T012
@pytest.mark.asyncio
async def test_tick_retry_exhausted_writes_annotation():
    """All 3 retries fail → post stays scheduled, annotation columns set."""
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    p = await _seed_post(
        owner_id=user.id, scheduled_at=now - timedelta(seconds=1), status="scheduled"
    )

    async def always_fail(db, post):
        raise RuntimeError("forever broken")

    with patch.object(publisher, "_flush_publish", side_effect=always_fail), \
         patch.object(publisher, "_BACKOFF_SECONDS", (0.0, 0.0, 0.0)):
        await _run_tick(now=now)

    after = await _get_post(p.id)
    assert after.status == "scheduled"
    assert after.last_publish_attempt_at is not None
    assert after.last_publish_error == publisher.ERR_TRANSIENT_DB


# T013
@pytest.mark.asyncio
async def test_tick_idempotent_on_published_row():
    """A row already in `published` is invisible to the tick query."""
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    p = await _seed_post(
        owner_id=user.id,
        scheduled_at=now - timedelta(hours=1),
        status="published",
    )

    await _run_tick(now=now)
    await _run_tick(now=now + timedelta(seconds=15))

    after = await _get_post(p.id)
    assert after.status == "published"


# T013a — FR-005 explicit coverage
@pytest.mark.asyncio
async def test_tick_skips_archived_post():
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    p = await _seed_post(
        owner_id=user.id,
        scheduled_at=now - timedelta(seconds=1),
        status="archived",
    )

    await _run_tick(now=now)

    after = await _get_post(p.id)
    assert after.status == "archived"


@pytest.mark.asyncio
async def test_tick_handles_deleted_post_gracefully():
    """If a row vanishes between the candidate query and the per-row
    publish call, the tick logs and continues — does not raise."""
    user = await _seed_user()
    now = _utc(2026, 5, 1, 14, 0)
    p = await _seed_post(
        owner_id=user.id,
        scheduled_at=now - timedelta(seconds=1),
        status="scheduled",
    )

    # Pre-delete the row so the candidate-then-publish race surfaces.
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(Post).where(Post.id == p.id))
        await db.commit()

    # Should not raise.
    summary = await _run_tick(now=now)

    assert summary.get("published", 0) == 0
