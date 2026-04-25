# Data model: Content Series

**Feature**: `specs/002-content-series`
**Date**: 2026-04-22

Concrete database shape, Pydantic schemas, cadence math, and
`check_platform_gap` spec. Aligned with the Clarifications already captured
in `spec.md` — no open questions.

## 1. `series` table (NEW)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PK, autoincrement | |
| `title` | VARCHAR(255) | NOT NULL | Pydantic `min_length=1` at API |
| `description` | VARCHAR(1000) | NULL | Optional |
| `platform` | VARCHAR(64) | NOT NULL | Same set as `Post.platform` (youtube, instagram, twitter, tiktok, linkedin). Enforced at API via `Literal[...]`. |
| `start_at` | DATETIME (tz-aware) | NOT NULL | First post's scheduled time (UTC on the wire) |
| `cadence_unit` | VARCHAR(16) | NOT NULL | `"days"` or `"weeks"` |
| `cadence_interval` | INTEGER | NOT NULL | 1..30 (API-enforced) |
| `post_count` | INTEGER | NOT NULL | 1..20 (API-enforced) |
| `owner_id` | INTEGER | NOT NULL, FK `users.id` | |
| `created_at` | DATETIME (tz-aware) | default now() | |
| `updated_at` | DATETIME (tz-aware) | default now(), on-update now() | |

No additional indexes in v1. Series volume per user is small.

## 2. `posts` table — additions

Two new nullable columns (additive change, no existing column touched):

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `series_id` | INTEGER | NULL, FK `series.id` | NULL = standalone post (existing behavior) |
| `series_position` | INTEGER | NULL | 0-indexed position within the series |

Invariant (enforced in code, not DB): `series_id IS NULL` iff
`series_position IS NULL`. Violated rows are not reachable through the API.

## 3. SQLAlchemy relationships

```text
User
  posts   = relationship("Post",   back_populates="owner",  cascade="all, delete-orphan")   # existing
  series  = relationship("Series", back_populates="owner",  cascade="all, delete-orphan")   # NEW

Series
  owner   = relationship("User",   back_populates="series")
  posts   = relationship("Post",   back_populates="series",
                                   cascade="all, delete-orphan",
                                   order_by="Post.series_position")

Post
  owner   = relationship("User",   back_populates="posts")   # existing
  series  = relationship("Series", back_populates="posts")    # NEW (nullable side)
```

Cascade on `Series.posts` means deleting a series removes its posts in the
same transaction — no orphan cleanup needed.

## 4. Idempotent schema evolution (FR-016)

Pseudocode for the added block at the end of `init_db()` in
`backend/app/core/database.py`:

```python
async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Idempotent ALTER for the two new Post columns.
        # create_all does NOT add columns to existing tables; SQLite supports
        # ALTER TABLE ADD COLUMN but has no IF NOT EXISTS, so we probe first.
        def _probe_and_alter(sync_conn):
            cols = {
                row[1]
                for row in sync_conn.exec_driver_sql(
                    "PRAGMA table_info(posts)"
                ).fetchall()
            }
            if "series_id" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN series_id INTEGER "
                    "REFERENCES series(id)"
                )
            if "series_position" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN series_position INTEGER"
                )

        await conn.run_sync(_probe_and_alter)
```

Behavior:

- Fresh DB: `create_all` generates `posts` with both new columns already
  present; the PRAGMA probe sees them; both branches short-circuit.
- Existing reviewer DB (pre-`002`): `create_all` generates the new
  `series` table; the PRAGMA probe on `posts` finds the columns absent;
  two `ALTER TABLE ADD COLUMN` statements run. Next start: short-circuit.
- SQLite note: `ALTER TABLE ... ADD COLUMN` in SQLite can attach a FK
  clause syntactically but doesn't actually enforce it at the DB layer
  without `PRAGMA foreign_keys = ON`. The app-level relationship handles
  cascade semantics; the FK clause is informational + forward-compatible
  if we migrate to Postgres.

## 5. Pydantic schemas

`backend/app/schemas/series.py` (NEW):

```python
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.schemas.post import PostResponse

Platform = Literal["youtube", "instagram", "twitter", "tiktok", "linkedin"]
CadenceUnit = Literal["days", "weeks"]

class SeriesBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1000)
    platform: Platform
    start_at: datetime
    cadence_unit: CadenceUnit
    cadence_interval: int = Field(ge=1, le=30)
    post_count: int = Field(ge=1, le=20)

class SeriesCreate(SeriesBase):
    pass

class SeriesUpdate(BaseModel):          # only metadata is editable (FR-005)
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1000)

class SeriesSummary(SeriesBase):        # LIST response item — no posts embedded
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class SeriesResponse(SeriesSummary):    # GET-by-id response — includes posts
    posts: list[PostResponse] = []
```

`backend/app/schemas/post.py` (MODIFIED — only `PostResponse`):

```python
class PostResponse(PostBase):
    id: int
    owner_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    series_id: Optional[int] = None            # NEW — read-only
    series_position: Optional[int] = None      # NEW — read-only

    class Config:
        from_attributes = True
```

`PostCreate` and `PostUpdate` are **not** modified (FR-005a).

## 6. Cadence math

Given `start_at`, `cadence_unit`, `cadence_interval`, `post_count`, the
N post timestamps are:

```python
def generate_schedule(
    start_at: datetime,
    cadence_unit: CadenceUnit,
    cadence_interval: int,
    post_count: int,
) -> list[datetime]:
    if cadence_unit == "days":
        step = timedelta(days=cadence_interval)
    elif cadence_unit == "weeks":
        step = timedelta(weeks=cadence_interval)
    else:
        raise ValueError(f"Unknown cadence_unit: {cadence_unit}")
    return [start_at + step * i for i in range(post_count)]
```

All math is done on timezone-aware datetimes. UTC on the wire; the UI
converts to local for display only.

## 7. `check_platform_gap` (Principle III)

`backend/app/core/scheduling.py` (NEW):

```python
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.post import Post

GAP = timedelta(minutes=15)

@dataclass(frozen=True)
class Conflict:
    other_post_id: int
    other_scheduled_at: datetime
    delta_minutes: float       # signed: positive = the other post is later

    @property
    def human_message(self) -> str:
        direction = "after" if self.delta_minutes > 0 else "before"
        return (
            f"Another post (#{self.other_post_id}) on the same platform is "
            f"scheduled {abs(self.delta_minutes):.0f} minutes {direction} "
            f"this one (at {self.other_scheduled_at.isoformat()})."
        )

async def check_platform_gap(
    db: AsyncSession,
    *,
    owner_id: int,
    platform: str,
    scheduled_at: Optional[datetime],
    exclude_post_id: Optional[int] = None,
) -> Optional[Conflict]:
    """Return None if the slot is clear; otherwise return the first Conflict found.

    Rules:
      - A null scheduled_at is always clear (drafts are exempt; FR-012).
      - Scope is per (owner_id, platform). Cross-owner and cross-platform
        combinations are never in conflict.
      - All posts with non-null scheduled_at are candidates, regardless of
        status (FR-008 amendment, Clarify-Q2).
      - Strict-less-than boundary: exactly 15 minutes apart is accepted.
      - Self-exclusion: when checking an UPDATE, exclude the post itself.
    """
    if scheduled_at is None:
        return None
    lower = scheduled_at - GAP
    upper = scheduled_at + GAP
    q = select(Post).where(
        Post.owner_id == owner_id,
        Post.platform == platform,
        Post.scheduled_at.is_not(None),
        Post.scheduled_at > lower,
        Post.scheduled_at < upper,
    )
    if exclude_post_id is not None:
        q = q.where(Post.id != exclude_post_id)
    result = await db.execute(q.limit(1))
    other = result.scalars().first()
    if other is None:
        return None
    delta_sec = (other.scheduled_at - scheduled_at).total_seconds()
    return Conflict(
        other_post_id=other.id,
        other_scheduled_at=other.scheduled_at,
        delta_minutes=delta_sec / 60.0,
    )
```

Boundary: `scheduled_at > lower AND scheduled_at < upper`. Exactly
`scheduled_at = lower` or `scheduled_at = upper` (i.e., exactly 15 minutes
apart) are accepted.

## 8. Bulk path (`POST /api/series`)

Pseudocode for the atomic series-create flow:

```python
async def create_series(data: SeriesCreate, db, user_id: int) -> SeriesResponse:
    times = generate_schedule(data.start_at, data.cadence_unit,
                              data.cadence_interval, data.post_count)

    # 1. Sibling pairwise check (same platform within 15 min of each other).
    for i in range(len(times)):
        for j in range(i + 1, len(times)):
            if abs((times[j] - times[i]).total_seconds()) < GAP.total_seconds():
                raise conflict_409(
                    message="Cadence is too dense: two generated posts "
                            f"would be within 15 min (positions {i} and {j}).",
                    conflict_with_post_id=None,           # intra-series
                    conflict_with_scheduled_at=times[j].isoformat(),
                    delta_minutes=(times[j] - times[i]).total_seconds() / 60.0,
                )

    # 2. DB check for each scheduled time.
    for i, t in enumerate(times):
        conflict = await check_platform_gap(
            db, owner_id=user_id, platform=data.platform, scheduled_at=t
        )
        if conflict is not None:
            raise conflict_409(
                message=conflict.human_message,
                conflict_with_post_id=conflict.other_post_id,
                conflict_with_scheduled_at=conflict.other_scheduled_at.isoformat(),
                delta_minutes=conflict.delta_minutes,
                # extra context for the series path:
                series_post_index=i,
            )

    # 3. Atomic write.
    series = Series(**data.model_dump(), owner_id=user_id)
    db.add(series)
    await db.flush()   # populate series.id without committing

    for i, t in enumerate(times):
        db.add(Post(
            title=f"{data.title} — part {i + 1}",
            platform=data.platform,
            scheduled_at=t,
            status="scheduled",
            owner_id=user_id,
            series_id=series.id,
            series_position=i,
        ))
    await db.commit()
    await db.refresh(series)
    return series
```

Key properties:

- Steps 1 and 2 run before any `db.add`. If either raises, the session
  hasn't written anything; rollback is a no-op.
- Step 3 is a single-transaction insert of 1 series + N posts. If the DB
  rejects at commit (very unlikely without concurrent writers), the ORM
  rolls back; zero rows persist.
- The 409 response shape matches FR-011: reuses `conflict_with_post_id`,
  `conflict_with_scheduled_at`, `delta_minutes`. A new optional
  `series_post_index` field is added for the series path (the first
  conflicting generated position) so the UI CAN surface "your post #N"
  context, but is not required to.
- First-conflict-wins: inner loops `break`/`raise` as soon as they find a
  collision (Clarify-Q3).

## 9. Test matrix

Minimum coverage to be shipped (Principle IV):

| Case | File | Expectation |
|---|---|---|
| Same owner, same platform, 10 min apart | `test_posts.py` | second POST → 409 |
| Same owner, same platform, exactly 15 min apart | `test_posts.py` | second POST → 201 |
| Same owner, same platform, 16 min apart | `test_posts.py` | both 201 |
| Same owner, different platforms, same timestamp | `test_posts.py` | both 201 |
| Different owners, same platform + timestamp | `test_scheduling.py` | both allowed (per-owner scoping) |
| PATCH self to its own timestamp | `test_posts.py` | 200 (self-exclusion) |
| PATCH attempts to set `series_id` | `test_posts.py` | attempt ignored; no membership change (FR-005a) |
| Invariant runs against any status (scheduled, published, failed) | `test_scheduling.py` | all count toward conflict set |
| Drafts (null `scheduled_at`) | `test_scheduling.py` | always accepted |
| Series happy path — weekly 4 posts | `test_series.py` | series + 4 posts created, ordered, tagged |
| Series blocks on existing post conflict | `test_series.py` | 409 + zero rows written |
| Series sibling conflict (contrived: post_count=1 OK; we verify via direct injection) | `test_series.py` | 409 (defensive) |
| Series cascade delete | `test_series.py` | series + its posts gone |
| Series cross-owner isolation | `test_series.py` | 404 for the other user |
| Series edit: title/description only | `test_series.py` | other fields rejected / ignored |
| Schema evolution on existing DB | `test_scheduling.py` or smoke | `PRAGMA table_info(posts)` contains both new columns after `init_db` |

## 10. Non-entities (out of scope for v1)

- No `series_name_slug` or uniqueness on title.
- No published-at timestamp beyond `scheduled_at`.
- No reschedule-all-posts endpoint.
- No bulk edit of series posts (each is editable via the existing
  `PATCH /api/posts/{id}` route, excluding series fields).
- No monthly / custom recurrence rules.
- No per-series platform set (v1 is exactly one platform per series).
