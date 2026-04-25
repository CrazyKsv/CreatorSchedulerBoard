# Data model: Series + invariant enforcement

Concrete shape for the new `Series` entity, the `Post` additions, and the
`check_platform_gap` helper. Derived from [`README.md`](./README.md).

## `Series` table

Pseudo-DDL (SQLAlchemy will generate the DDL via `Base.metadata.create_all`):

```text
series
  id                integer primary key
  title             string(255) not null
  description       string(1000) null
  platform          string(64) not null        # one of: youtube, instagram, twitter, tiktok, linkedin
  start_at          datetime(tz) not null      # first post's scheduled time, UTC on the wire
  cadence_unit      string(16) not null        # "days" or "weeks"
  cadence_interval  integer not null           # >= 1
  post_count        integer not null           # 1..20
  owner_id          integer not null FK(users.id)
  created_at        datetime(tz) default now()
  updated_at        datetime(tz) default now() on update now()
```

Constraints (enforced in Pydantic at the API boundary — SQLite doesn't do
check constraints reliably):

- `cadence_unit in {"days", "weeks"}`
- `1 <= cadence_interval <= 30`
- `1 <= post_count <= 20`
- `title` non-empty

Indexes: none beyond the default PK. Series volume per user is small.

## `Post` additions

Two new nullable columns:

```text
posts
  ... (existing columns unchanged) ...
  series_id         integer null FK(series.id)
  series_position   integer null     # 0-indexed within the series (0 = first post)
```

`series_id` must be `NULL` or reference an existing series. `series_position`
must be `NULL` iff `series_id` is `NULL`; non-null when in a series.

Delete rule: when a series row is deleted, its posts are deleted too
(`cascade="all, delete-orphan"` on the SQLAlchemy relationship — matches
the existing `User.posts` pattern).

## SQLAlchemy relationship wiring

```text
User
  series = relationship("Series", back_populates="owner", cascade="all, delete-orphan")

Series
  owner  = relationship("User",  back_populates="series")
  posts  = relationship("Post",  back_populates="series",
                                 cascade="all, delete-orphan",
                                 order_by="Post.series_position")

Post
  series = relationship("Series", back_populates="posts")
```

## Pydantic schemas

`backend/app/schemas/series.py`:

```text
SeriesBase:
  title: str
  description: Optional[str] = None
  platform: Literal["youtube","instagram","twitter","tiktok","linkedin"]
  start_at: datetime
  cadence_unit: Literal["days","weeks"]
  cadence_interval: int = Field(ge=1, le=30)
  post_count: int = Field(ge=1, le=20)

SeriesCreate(SeriesBase): pass

SeriesUpdate:  # v1 only allows metadata edits
  title: Optional[str] = None
  description: Optional[str] = None

SeriesResponse(SeriesBase):
  id: int
  owner_id: int
  created_at: datetime
  updated_at: datetime
  posts: list[PostResponse]   # populated on GET /{id}; omitted or empty on list
```

`backend/app/schemas/post.py` — add two fields to `PostResponse`:

```text
PostResponse(PostBase):
  ...
  series_id: Optional[int] = None
  series_position: Optional[int] = None
```

## Cadence math

Given `start_at`, `cadence_unit`, `cadence_interval`, `post_count`, the post
timestamps are:

```text
for i in range(post_count):
    delta = timedelta(days=cadence_interval)        if unit == "days"
          else timedelta(weeks=cadence_interval)     if unit == "weeks"
    scheduled_at_i = start_at + delta * i
```

All math in UTC to sidestep DST edge cases. The UI converts to local for
display only.

## `check_platform_gap` — the invariant

`backend/app/core/scheduling.py`:

```text
BUFFER = timedelta(minutes=15)

async def check_platform_gap(
    db: AsyncSession,
    owner_id: int,
    platform: str,
    scheduled_at: datetime,
    exclude_post_id: Optional[int] = None,
) -> Optional[Conflict]:
    """
    Returns None if `scheduled_at` is at least 15 minutes away from every
    existing post by the same owner on the same platform (excluding
    `exclude_post_id` if provided — used by PATCH so a post doesn't
    conflict with itself).

    Returns a Conflict(other_post_id, other_scheduled_at, delta_seconds)
    on the first violation found (not necessarily the closest — fine for v1).
    """
    if scheduled_at is None:
        return None                      # drafts are free
    lower = scheduled_at - BUFFER
    upper = scheduled_at + BUFFER
    q = select(Post).where(
        Post.owner_id == owner_id,
        Post.platform == platform,
        Post.scheduled_at.is_not(None),
        Post.scheduled_at > lower,
        Post.scheduled_at < upper,
    )
    if exclude_post_id is not None:
        q = q.where(Post.id != exclude_post_id)
    result = await db.execute(q)
    other = result.scalars().first()
    if other is None:
        return None
    return Conflict(other.id, other.scheduled_at, ...)
```

Boundary semantics: the query uses strict `>` and `<`, so **exactly 15 minutes
apart** is accepted. Anything within (0, 15) minutes is rejected.

### Bulk path (series create)

For `POST /api/series` we must also check that the series' own posts don't
conflict with each other — not just with existing posts. Sketch:

```text
1. Compute the list of N scheduled_at values from cadence math.
2. If any two of them are within 15 min of each other on the same platform
   → 400 Bad Request with a descriptive cadence-too-dense error (this
   actually only happens if cadence_interval + cadence_unit produces a
   step < 15 min, which our bounds prevent — but check defensively).
3. For each scheduled_at, call check_platform_gap against the DB
   (excluding the series' own yet-to-be-committed posts, which are in
   memory at this point).
4. If any conflict → 409 with the first conflict; do NOT partially
   persist. The whole operation runs inside a single transaction and
   rolls back on raise.
```

## Error shape

Single convention for both single-post and series-bulk conflicts:

```json
HTTP 409 Conflict
{
  "detail": {
    "error": "platform_gap_conflict",
    "message": "Another instagram post is scheduled at 2026-04-22T14:05:00Z (10 minutes away).",
    "conflict_with_post_id": 42,
    "conflict_with_scheduled_at": "2026-04-22T14:05:00Z",
    "delta_minutes": 10
  }
}
```

The frontend pulls `detail.message` for the toast/error box.

## Migration strategy

SQLite + `Base.metadata.create_all` handles a fresh DB fine. For an
**existing** seeded DB (which is what most reviewers will have after running
the merged `001-docker-compose` feature), two options:

1. **Recommended**: `rm -f backend/scheduler.db && docker compose up` — the
   entrypoint re-seeds, schema is created fresh. Matches the "reset"
   recipe documented in `docs/docker-setup.md`.
2. If data preservation matters (it does not for a take-home), a minimal
   Alembic setup would be a follow-up PR.

Document the reset step in the Series PR description.

## Invariant test matrix

Minimum coverage (all in `backend/tests/test_posts.py` or new
`test_scheduling.py`):

| Case | Expectation |
| --- | --- |
| Two posts, same platform, 10 min apart | second rejected with 409 |
| Two posts, same platform, exactly 15 min apart | second accepted |
| Two posts, same platform, 16 min apart | both accepted |
| Two posts, different platforms, same timestamp | both accepted |
| Two posts, same platform, same timestamp, different users | both accepted (rule is per-owner — see Open Q1) |
| PATCH existing post to its own current timestamp | accepted (self-exclusion works) |
| Series with cadence that clears 15 min between siblings | all N posts created |
| Series that would straddle an existing post within 15 min | 409, zero rows written |
| Drafts (null `scheduled_at`) | always accepted regardless of platform |

"Exactly 15 minutes apart = accepted" is the one assertion the reviewer is
likely to scrutinize. Keep it first.
