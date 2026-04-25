"""15-minute same-platform scheduling invariant (Constitution Principle III)
plus the cadence-math helper used by the series-create path.

See:
- specs/002-content-series/contracts/scheduling-invariant.md for the
  binding contract.
- specs/002-content-series/data-model.md §7-§8 for pseudocode.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.post import Post

GAP = timedelta(minutes=15)

# Project-standard timezone for "is this in the past?" checks. The wire
# format for scheduled_at is a naive ISO string that the UI writes as a
# wall-clock EST time (see frontend utils.js toIsoLocal); we interpret
# naive inputs here as that same EST wall clock so the frontend and
# backend agree on what "past" means.
EST = ZoneInfo("America/New_York")


def to_est(dt: datetime) -> datetime:
    """Single source of truth for the naive→EST normalization the
    project leans on everywhere: naive datetimes are interpreted as EST
    wall-clock (matching the wire format), aware ones are converted to
    EST. Always returns an aware datetime.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=EST)
    return dt.astimezone(EST)


def now_est_naive() -> datetime:
    """Current EST wall-clock as a NAIVE datetime — same shape as the
    `scheduled_at` values stored in SQLite (which strips tz). Used by
    `stats.py` and `seed_data.py` so neither needs its own copy.
    """
    return datetime.now(EST).replace(tzinfo=None, microsecond=0)


def is_past_est(scheduled_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    """True when `scheduled_at` is at or before `now` in EST wall-clock.

    Minute-precision comparison: the UI's date+time inputs never carry
    sub-minute detail, so seconds/microseconds are dropped on both sides.
    `now` defaults to the current EST wall-clock; pass an explicit value
    in tests / from the publisher loop where determinism matters.
    """
    if scheduled_at is None:
        return False
    dt = to_est(scheduled_at).replace(second=0, microsecond=0)
    base = (to_est(now) if now is not None else datetime.now(EST)).replace(
        second=0, microsecond=0
    )
    return dt <= base

CadenceUnit = Literal["days", "weeks"]


@dataclass(frozen=True)
class Conflict:
    """Returned by check_platform_gap when a scheduling collision is found.

    `delta_minutes` is SIGNED: positive means the other post is scheduled
    LATER than the candidate time; negative means EARLIER.
    """

    other_post_id: int
    other_scheduled_at: datetime
    delta_minutes: float

    @property
    def human_message(self) -> str:
        direction = "after" if self.delta_minutes > 0 else "before"
        minutes = abs(self.delta_minutes)
        return (
            f"Another post (#{self.other_post_id}) on the same platform is "
            f"scheduled {minutes:.0f} minutes {direction} this one "
            f"(at {self.other_scheduled_at.isoformat()})."
        )


async def check_platform_gap(
    db: AsyncSession,
    *,
    owner_id: int,
    platform: str,
    scheduled_at: Optional[datetime],
    exclude_post_id: Optional[int] = None,
) -> Optional[Conflict]:
    """Return None if the slot is clear; otherwise the first Conflict found.

    Semantics (FR-008 through FR-013):
    - scheduled_at=None is always clear (drafts are exempt, FR-012).
    - Per-owner + per-platform scope; different owners / platforms never collide.
    - All posts with non-null scheduled_at count, regardless of `status`.
    - Strict < boundary on both sides: exactly 15 min apart is accepted (FR-009).
    - exclude_post_id: the caller's post id, for self-exclusion on PATCH (FR-013).
    """
    if scheduled_at is None:
        return None

    lower = scheduled_at - GAP
    upper = scheduled_at + GAP
    q = (
        select(Post)
        .where(
            Post.owner_id == owner_id,
            Post.platform == platform,
            Post.scheduled_at.is_not(None),
            Post.scheduled_at > lower,
            Post.scheduled_at < upper,
            Post.status != "archived",  # FR-018 / 003 Clarify-Q4
        )
        .limit(1)
    )
    if exclude_post_id is not None:
        q = q.where(Post.id != exclude_post_id)

    result = await db.execute(q)
    other = result.scalars().first()
    if other is None:
        return None

    # SQLite round-trips datetimes as naive; normalize both sides to
    # tz-aware UTC before arithmetic so aware input doesn't collide
    # with naive storage.
    other_at = other.scheduled_at
    if other_at.tzinfo is None:
        other_at = other_at.replace(tzinfo=timezone.utc)
    me_at = scheduled_at
    if me_at.tzinfo is None:
        me_at = me_at.replace(tzinfo=timezone.utc)

    delta_seconds = (other_at - me_at).total_seconds()
    return Conflict(
        other_post_id=other.id,
        other_scheduled_at=other_at,
        delta_minutes=delta_seconds / 60.0,
    )


@dataclass(frozen=True)
class SeqConflict:
    """Returned by check_sequential_integrity on the first ordering violation.

    Indices are 0-based (matches Python list indexing); the user-facing
    `human_message` converts to 1-based stage numbers for display
    (Principle VII / Principle X message-shape consistency).
    """

    offending_index: int
    prior_index: int
    offending_at: datetime
    prior_at: datetime

    @property
    def human_message(self) -> str:
        return (
            f"Stage #{self.offending_index + 1} is scheduled at or before "
            f"stage #{self.prior_index + 1} (Sequential Integrity)."
        )


def check_sequential_integrity(times: list[datetime]) -> Optional[SeqConflict]:
    """Return None when `times` is strictly monotonically increasing; otherwise
    return a SeqConflict describing the FIRST pair (i-1, i) where
    times[i] <= times[i-1].

    Pure function — no DB access. Called by the templated series-create
    path and by the PATCH path when a series-child post's scheduled_at
    changes.

    Empty and single-element lists return None (no pair to compare).
    """
    for i in range(1, len(times)):
        if times[i] <= times[i - 1]:
            return SeqConflict(
                offending_index=i,
                prior_index=i - 1,
                offending_at=times[i],
                prior_at=times[i - 1],
            )
    return None


def generate_schedule(
    start_at: datetime,
    cadence_unit: CadenceUnit,
    cadence_interval: int,
    post_count: int,
) -> list[datetime]:
    """Compute the N scheduled_at timestamps for a series.

    `scheduled_at_i = start_at + i * (cadence_interval × unit)` for i in [0, N).
    """
    if cadence_unit == "days":
        step = timedelta(days=cadence_interval)
    elif cadence_unit == "weeks":
        step = timedelta(weeks=cadence_interval)
    else:
        raise ValueError(f"Unknown cadence_unit: {cadence_unit!r}")
    return [start_at + step * i for i in range(post_count)]
