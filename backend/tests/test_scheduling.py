"""Unit tests for the 15-minute same-platform scheduling invariant.

Covers `backend/app/core/scheduling.py::check_platform_gap` and the
`generate_schedule` helper. Written test-first per Constitution
Principle IX (NON-NEGOTIABLE for backend API correctness modules).
"""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.scheduling import (
    GAP,
    Conflict,
    SeqConflict,
    check_platform_gap,
    check_sequential_integrity,
    generate_schedule,
)
from app.models.post import Post
from app.models.user import User


@pytest.fixture
async def alice(client: AsyncClient):
    """Register alice and return her row + Bearer headers."""
    await client.post(
        "/api/v1/auth/register",
        json={"email": "alice@example.com", "password": "pw", "full_name": "Alice"},
    )
    r = await client.post(
        "/api/v1/auth/login", json={"email": "alice@example.com", "password": "pw"}
    )
    token = r.json()["access_token"]
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == "alice@example.com"))).scalar_one()
    return {"user": user, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture
async def bob(client: AsyncClient):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "bob@example.com", "password": "pw", "full_name": "Bob"},
    )
    r = await client.post(
        "/api/v1/auth/login", json={"email": "bob@example.com", "password": "pw"}
    )
    token = r.json()["access_token"]
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == "bob@example.com"))).scalar_one()
    return {"user": user, "headers": {"Authorization": f"Bearer {token}"}}


async def _insert_post(
    owner_id: int,
    platform: str,
    scheduled_at: datetime | None,
    status: str = "scheduled",
) -> int:
    async with AsyncSessionLocal() as db:
        post = Post(
            title="probe",
            platform=platform,
            scheduled_at=scheduled_at,
            status=status,
            owner_id=owner_id,
        )
        db.add(post)
        await db.commit()
        await db.refresh(post)
        return post.id


# ---------------------------------------------------------------- check_platform_gap

@pytest.mark.asyncio
async def test_returns_none_when_scheduled_at_is_null(alice):
    """Drafts (scheduled_at=None) are exempt (FR-012)."""
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=None,
        )
    assert result is None


@pytest.mark.asyncio
async def test_returns_none_when_no_other_post(alice):
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc),
        )
    assert result is None


@pytest.mark.asyncio
async def test_returns_conflict_within_window(alice):
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0)
    async with AsyncSessionLocal() as db:
        conflict = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=10),
        )
    assert conflict is not None
    assert conflict.delta_minutes == pytest.approx(-10, abs=0.1)


@pytest.mark.asyncio
async def test_returns_none_at_exact_15_minute_boundary(alice):
    """FR-009: exactly 15 min apart is accepted (strict < on both sides)."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0)
    async with AsyncSessionLocal() as db:
        later = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=15),
        )
        earlier = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 - timedelta(minutes=15),
        )
    assert later is None
    assert earlier is None


@pytest.mark.asyncio
async def test_returns_none_for_different_platform(alice):
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0)
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="tiktok",
            scheduled_at=t0,
        )
    assert result is None


@pytest.mark.asyncio
async def test_returns_none_for_different_owner(alice, bob):
    """Per-owner scoping: alice's post doesn't constrain bob (Clarify-Q1 default)."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0)
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=bob["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=5),
        )
    assert result is None


@pytest.mark.asyncio
async def test_excludes_post_id_when_provided(alice):
    """Self-exclusion: PATCHing a post at its own time does not conflict with itself."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    own_id = await _insert_post(alice["user"].id, "instagram", t0)
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0,
            exclude_post_id=own_id,
        )
    assert result is None


@pytest.mark.parametrize("status", ["draft", "scheduled", "published", "failed"])
@pytest.mark.asyncio
async def test_includes_posts_of_any_status(alice, status):
    """Clarify-Q2 / FR-008 amendment: all non-null scheduled_at posts count, regardless of status."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0, status=status)
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=5),
        )
    assert result is not None, f"status={status} should still count toward conflicts"


@pytest.mark.asyncio
async def test_conflict_object_contains_expected_fields(alice):
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    other_id = await _insert_post(alice["user"].id, "instagram", t0)
    async with AsyncSessionLocal() as db:
        conflict = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=5),
        )
    assert isinstance(conflict, Conflict)
    assert conflict.other_post_id == other_id
    assert "instagram" in conflict.human_message.lower() or "post" in conflict.human_message.lower()


def test_gap_constant_is_15_minutes():
    assert GAP == timedelta(minutes=15)


# ---------------------------------------------------------------- generate_schedule

def test_generate_schedule_weekly_four_posts():
    start = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    out = generate_schedule(start, "weeks", 1, 4)
    assert out == [
        start,
        start + timedelta(weeks=1),
        start + timedelta(weeks=2),
        start + timedelta(weeks=3),
    ]


def test_generate_schedule_daily_two_posts():
    start = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    out = generate_schedule(start, "days", 3, 2)
    assert out == [start, start + timedelta(days=3)]


def test_generate_schedule_invalid_unit_raises():
    start = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        generate_schedule(start, "years", 1, 2)  # type: ignore[arg-type]


# ====================================================================
# 003 — archive-exclusion on check_platform_gap (FR-018, Clarify-Q4)
# ====================================================================


@pytest.mark.asyncio
async def test_returns_none_when_matching_post_is_archived(alice):
    """FR-018: archived posts are excluded from the conflict set."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0, status="archived")
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=5),
        )
    assert result is None


@pytest.mark.asyncio
async def test_returns_none_when_multiple_archived_posts_in_window(alice):
    """All archived posts in the window are excluded — not just the first."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    for offset_min in (-10, -5, 0, 5, 10):
        await _insert_post(
            alice["user"].id,
            "instagram",
            t0 + timedelta(minutes=offset_min),
            status="archived",
        )
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0,
        )
    assert result is None


@pytest.mark.asyncio
async def test_conflict_ignores_archived_when_scheduled_sibling_also_present(alice):
    """If one archived post AND one scheduled post are both in the window,
    the conflict is attributed to the scheduled one (archived is invisible)."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(
        alice["user"].id,
        "instagram",
        t0 - timedelta(minutes=8),
        status="archived",
    )
    scheduled_id = await _insert_post(
        alice["user"].id,
        "instagram",
        t0 + timedelta(minutes=8),
        status="scheduled",
    )
    async with AsyncSessionLocal() as db:
        conflict = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0,
        )
    assert conflict is not None
    assert conflict.other_post_id == scheduled_id


@pytest.mark.asyncio
async def test_archived_at_exact_15min_boundary_does_not_block(alice):
    """Archived + boundary: archived is already excluded, boundary is moot."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0, status="archived")
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=15),
        )
    assert result is None


@pytest.mark.parametrize("status", ["draft", "scheduled", "published", "failed"])
@pytest.mark.asyncio
async def test_non_archived_statuses_still_count_toward_conflict(alice, status):
    """Confirms FR-018 is surgical — only archived is exempt, not the others."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    await _insert_post(alice["user"].id, "instagram", t0, status=status)
    async with AsyncSessionLocal() as db:
        result = await check_platform_gap(
            db,
            owner_id=alice["user"].id,
            platform="instagram",
            scheduled_at=t0 + timedelta(minutes=5),
        )
    assert result is not None, f"{status} must still count"


# ====================================================================
# 003 — check_sequential_integrity pure function (FR-020)
# ====================================================================


def test_check_sequential_integrity_empty_list_returns_none():
    """Pure function must accept an empty list without raising."""
    assert check_sequential_integrity([]) is None


def test_check_sequential_integrity_single_element_returns_none():
    """A single-element list has no pair to compare."""
    only = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    assert check_sequential_integrity([only]) is None


def test_check_sequential_integrity_strictly_increasing_returns_none():
    times = [
        datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc),
        datetime(2026, 5, 2, 10, 0, tzinfo=timezone.utc),
        datetime(2026, 5, 5, 11, 0, tzinfo=timezone.utc),
        datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc),
    ]
    assert check_sequential_integrity(times) is None


def test_check_sequential_integrity_equal_adjacent_returns_conflict():
    """Equality is a violation per strict-monotonic-increase rule."""
    t = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    times = [t, t, t + timedelta(hours=1), t + timedelta(hours=2)]
    conflict = check_sequential_integrity(times)
    assert conflict is not None
    assert conflict.offending_index == 1
    assert conflict.prior_index == 0
    assert conflict.offending_at == t
    assert conflict.prior_at == t


def test_check_sequential_integrity_later_before_earlier_returns_conflict():
    """A later-index stage scheduled BEFORE an earlier-index stage."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    times = [t0, t0 - timedelta(minutes=30), t0 + timedelta(hours=1), t0 + timedelta(hours=2)]
    conflict = check_sequential_integrity(times)
    assert conflict is not None
    assert conflict.offending_index == 1
    assert conflict.prior_index == 0


def test_check_sequential_integrity_returns_first_violation_only():
    """If multiple violations exist, the FIRST one (lowest index) is returned."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    # violations at index 1 AND index 3
    times = [
        t0,
        t0 - timedelta(minutes=1),  # violates vs index 0
        t0 + timedelta(hours=2),
        t0 + timedelta(hours=1),  # violates vs index 2
    ]
    conflict = check_sequential_integrity(times)
    assert conflict is not None
    assert conflict.offending_index == 1
    assert conflict.prior_index == 0


def test_check_sequential_integrity_last_pair_violation():
    """Violation at the tail of the list."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    times = [
        t0,
        t0 + timedelta(hours=1),
        t0 + timedelta(hours=2),
        t0 + timedelta(hours=1, minutes=30),  # before prior
    ]
    conflict = check_sequential_integrity(times)
    assert conflict is not None
    assert conflict.offending_index == 3
    assert conflict.prior_index == 2


def test_check_sequential_integrity_microsecond_difference_passes():
    """Strict-less-than allows microsecond-level strictly-increasing times."""
    t0 = datetime(2026, 5, 1, 9, 0, 0, 0, tzinfo=timezone.utc)
    times = [
        t0,
        t0 + timedelta(microseconds=1),
        t0 + timedelta(microseconds=2),
        t0 + timedelta(microseconds=3),
    ]
    assert check_sequential_integrity(times) is None


def test_check_sequential_integrity_seq_conflict_is_dataclass():
    """SeqConflict is a frozen dataclass with documented fields."""
    from dataclasses import is_dataclass

    assert is_dataclass(SeqConflict)
    t = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    c = SeqConflict(offending_index=2, prior_index=1, offending_at=t, prior_at=t)
    # frozen: setattr raises
    import dataclasses

    with pytest.raises(dataclasses.FrozenInstanceError):
        c.offending_index = 99  # type: ignore[misc]


def test_check_sequential_integrity_seq_conflict_human_message():
    """Human-facing message uses 1-based stage numbers for user display."""
    t = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    c = SeqConflict(
        offending_index=2, prior_index=1, offending_at=t, prior_at=t + timedelta(hours=1)
    )
    msg = c.human_message
    # 1-based indexing surfaces as "#3" and "#2" respectively.
    assert "#3" in msg
    assert "#2" in msg


def test_check_sequential_integrity_large_list_performance():
    """Sanity check — 10_000 strictly-increasing timestamps return None."""
    t0 = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    times = [t0 + timedelta(minutes=i) for i in range(10_000)]
    assert check_sequential_integrity(times) is None
