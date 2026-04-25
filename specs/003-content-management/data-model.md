# Data model: Content Management (003 upgrade)

**Feature**: `specs/003-content-management`
**Date**: 2026-04-22

Concrete schema deltas, Pydantic schema additions, `check_platform_gap`
+ `check_sequential_integrity` pseudocode, templated series-create bulk-write
flow, and test matrix. Aligned with the 13 Clarifications in `spec.md`.

## 1. Schema deltas

### `posts` — add 4 columns

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `body` | `TEXT` | YES | ≤ 5000 chars enforced at API layer (Pydantic) |
| `published_url` | `VARCHAR(1024)` | YES | Set when `status = 'published'` by a future publisher; 003 does not set it (the field surfaces it read-only) |
| `stage` | `VARCHAR(32)` | YES | One of `Teaser | Announcement | Follow-up | Reminder` for templated series-child posts; NULL for standalone posts and legacy (002) series posts |
| `previous_status` | `VARCHAR(32)` | YES | Holds the pre-archive status for round-trip restore |

`posts.status` values (string column, no schema change): add
`archived` to the allowed set. `canceled` is intentionally NOT part
of the 003 upgrade (Clarify-Q5).

### `series` — add 2 columns

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `status` | `VARCHAR(32)` | NO (default `'active'`) | `active` or `archived` |
| `previous_status` | `VARCHAR(32)` | YES | Pre-archive status for round-trip restore |

Legacy 002 `series` rows load with `status = 'active'` via the default
constraint.

### Migration (idempotent `ALTER`, per FR-029)

Extend the existing `_probe_and_alter` block in
`backend/app/core/database.py::init_db`:

```python
def _probe_and_alter(sync_conn):
    # 002 additions (already present): posts.series_id, posts.series_position
    # 003 additions:
    posts_cols = {row[1] for row in sync_conn.exec_driver_sql("PRAGMA table_info(posts)").fetchall()}
    if "body" not in posts_cols:
        sync_conn.exec_driver_sql("ALTER TABLE posts ADD COLUMN body TEXT")
    if "published_url" not in posts_cols:
        sync_conn.exec_driver_sql("ALTER TABLE posts ADD COLUMN published_url VARCHAR(1024)")
    if "stage" not in posts_cols:
        sync_conn.exec_driver_sql("ALTER TABLE posts ADD COLUMN stage VARCHAR(32)")
    if "previous_status" not in posts_cols:
        sync_conn.exec_driver_sql("ALTER TABLE posts ADD COLUMN previous_status VARCHAR(32)")

    series_cols = {row[1] for row in sync_conn.exec_driver_sql("PRAGMA table_info(series)").fetchall()}
    if "status" not in series_cols:
        sync_conn.exec_driver_sql("ALTER TABLE series ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'")
    if "previous_status" not in series_cols:
        sync_conn.exec_driver_sql("ALTER TABLE series ADD COLUMN previous_status VARCHAR(32)")
```

Fresh DBs get these via `create_all` from the updated models. No
reviewer reset needed.

## 2. Updated ORM models

### `backend/app/models/post.py`

```python
class Post(Base):
    __tablename__ = "posts"
    # ... existing columns (id, title, platform, scheduled_at, status, owner_id,
    #                     series_id, series_position, created_at, updated_at) ...
    body             = Column(Text, nullable=True)
    published_url    = Column(String(1024), nullable=True)
    stage            = Column(String(32), nullable=True)
    previous_status  = Column(String(32), nullable=True)
    # relationships unchanged
```

### `backend/app/models/series.py`

```python
class Series(Base):
    __tablename__ = "series"
    # ... existing columns from 002 ...
    status           = Column(String(32), nullable=False, default="active")
    previous_status  = Column(String(32), nullable=True)
    # relationships unchanged
```

## 3. Updated Pydantic schemas

### `backend/app/schemas/post.py`

```python
Status = Literal["draft", "scheduled", "published", "failed", "archived"]
Platform = Literal["youtube", "instagram", "twitter", "tiktok", "linkedin"]
Stage = Literal["Teaser", "Announcement", "Follow-up", "Reminder"]

class PostBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    platform: Platform
    scheduled_at: Optional[datetime] = None
    status: Status = "draft"
    body: Optional[str] = Field(default=None, max_length=5000)

class PostCreate(PostBase):
    pass

class PostUpdate(BaseModel):
    # FR-010 (003): allow platform + scheduled_at + title + body + status edits
    # on any post (standalone or series-child). series_id / series_position /
    # stage / previous_status / published_url are NOT editable via PATCH.
    title: Optional[str] = None
    platform: Optional[Platform] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[Status] = None
    body: Optional[str] = Field(default=None, max_length=5000)

class PostResponse(PostBase):
    id: int
    owner_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    series_id: Optional[int] = None
    series_position: Optional[int] = None
    stage: Optional[Stage] = None
    published_url: Optional[str] = None
    previous_status: Optional[Status] = None
    author: Optional[str] = None   # derived from owner.full_name at serialization time (NOT a column)

    class Config:
        from_attributes = True
```

### `backend/app/schemas/series.py` (additions)

```python
class SeriesStagePayload(BaseModel):
    stage: Stage                              # literal, position-validated at endpoint
    platform: Platform
    title: str = Field(min_length=1, max_length=255)
    body: Optional[str] = Field(default=None, max_length=5000)
    scheduled_at: datetime

class SeriesCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1000)
    stages: list[SeriesStagePayload] = Field(min_length=4, max_length=4)  # exactly 4

class SeriesSummary(BaseModel):
    # ... existing from 002 ...
    status: Literal["active", "archived"] = "active"
    previous_status: Optional[str] = None

class SeriesResponse(SeriesSummary):
    posts: list[PostResponse] = []
```

## 4. Scheduling invariant (updated)

### `check_platform_gap` — excludes archived (FR-018)

```python
async def check_platform_gap(db, *, owner_id, platform, scheduled_at, exclude_post_id=None):
    if scheduled_at is None:
        return None
    lower, upper = scheduled_at - GAP, scheduled_at + GAP
    q = (
        select(Post)
        .where(
            Post.owner_id == owner_id,
            Post.platform == platform,
            Post.scheduled_at.is_not(None),
            Post.scheduled_at > lower,
            Post.scheduled_at < upper,
            Post.status != "archived",    # NEW — Clarify-Q4 (pre-spec)
        )
        .limit(1)
    )
    if exclude_post_id is not None:
        q = q.where(Post.id != exclude_post_id)
    result = await db.execute(q)
    other = result.scalars().first()
    # ... same tz-normalization + Conflict return as 002 ...
```

### `check_sequential_integrity` — new pure function (FR-020)

```python
@dataclass(frozen=True)
class SeqConflict:
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
    """Return the first pair where times[i] <= times[i-1]; None if strictly increasing."""
    for i in range(1, len(times)):
        if times[i] <= times[i - 1]:
            return SeqConflict(i, i - 1, times[i], times[i - 1])
    return None
```

## 5. Templated series-create flow

`POST /api/v1/series` handler pseudocode (replaces the 002 cadence-based
body; function name is just `create_series` — single creation path):

```python
async def create_series(data: SeriesCreate, db, user_id):
    # Position-validate stage labels (Pydantic Literal gives us the enum; this
    # adds ordering):
    expected = ["Teaser", "Announcement", "Follow-up", "Reminder"]
    for i, s in enumerate(data.stages):
        if s.stage != expected[i]:
            raise HTTPException(422, detail={"error": "invalid_stage_order",
                                             "message": f"Stage #{i+1} must be {expected[i]}"})

    times = [s.scheduled_at for s in data.stages]

    # Sequential Integrity (FR-020).
    seq = check_sequential_integrity(times)
    if seq is not None:
        raise HTTPException(409, detail={
            "error": "sequential_integrity_violation",
            "message": seq.human_message,
            "offending_post_index": seq.offending_index,
            "prior_post_index": seq.prior_index,
        })

    # Per-stage 15-min check against existing posts (archived excluded).
    for i, s in enumerate(data.stages):
        conflict = await check_platform_gap(
            db, owner_id=user_id, platform=s.platform, scheduled_at=s.scheduled_at
        )
        if conflict is not None:
            _raise_platform_gap_conflict(conflict, series_post_index=i)

    # Pairwise 15-min check across the stages themselves (same-platform only).
    for i in range(len(times)):
        for j in range(i + 1, len(times)):
            if data.stages[i].platform == data.stages[j].platform:
                delta = abs((times[j] - times[i]).total_seconds())
                if delta < GAP.total_seconds():
                    _raise_pairwise_sibling_conflict(i, j, times[i], times[j])

    # Atomic write.
    series = Series(
        name=data.name,
        description=data.description,
        platform=data.stages[0].platform,   # representative only; no longer authoritative
        start_at=times[0],
        cadence_unit="days",                # placeholder (legacy column)
        cadence_interval=1,                 # placeholder
        post_count=4,
        owner_id=user_id,
        status="active",
    )
    db.add(series)
    await db.flush()

    for i, s in enumerate(data.stages):
        db.add(Post(
            title=s.title,
            platform=s.platform,
            scheduled_at=s.scheduled_at,
            status="scheduled",
            body=s.body,
            stage=s.stage,
            owner_id=user_id,
            series_id=series.id,
            series_position=i,
        ))
    await db.commit()

    return await _load_series_with_posts(db, series.id)
```

## 6. Archive / unarchive flows

**Invariant (no stacking)**: every archive action overwrites
`previous_status` with the current `status` value (even if
`previous_status` was already non-null from a prior archive that was
then unarchived — archiving always rewrites). Every unarchive action
clears `previous_status` back to `NULL` after restoring. There is no
"stack" of prior statuses — only the most recent pre-archive state is
preserved. The same rule applies to `series.previous_status`, which
only ever holds `"active"` in practice since `status` has two values.

### Post archive (`POST /api/v1/posts/{id}/archive`)

```python
async def archive_post(post_id: int, db, user_id):
    post = await _load_owned_post(db, post_id, user_id)
    if post.status == "archived":
        raise HTTPException(409, detail={"error": "already_archived"})
    post.previous_status = post.status
    post.status = "archived"
    await db.commit()
    await db.refresh(post)
    return post
```

### Post unarchive (`POST /api/v1/posts/{id}/unarchive`)

```python
async def unarchive_post(post_id: int, db, user_id):
    post = await _load_owned_post(db, post_id, user_id)
    if post.status != "archived":
        raise HTTPException(409, detail={"error": "not_archived"})
    post.status = post.previous_status or "draft"
    post.previous_status = None
    await db.commit()
    await db.refresh(post)
    return post
```

### Series archive (`POST /api/v1/series/{id}/archive`, FR-017)

```python
async def archive_series(series_id: int, db, user_id):
    series = await _load_owned_series_with_posts(db, series_id, user_id)
    if series.status == "archived":
        raise HTTPException(409, detail={"error": "already_archived"})
    series.previous_status = "active"
    series.status = "archived"
    for p in series.posts:
        if p.status != "archived":
            p.previous_status = p.status
            p.status = "archived"
    await db.commit()
    return await _load_owned_series_with_posts(db, series_id, user_id)
```

### Series unarchive — restore series + every post whose `previous_status` is set

```python
async def unarchive_series(series_id: int, db, user_id):
    series = await _load_owned_series_with_posts(db, series_id, user_id)
    if series.status != "archived":
        raise HTTPException(409, detail={"error": "not_archived"})
    series.status = series.previous_status or "active"
    series.previous_status = None
    for p in series.posts:
        if p.status == "archived" and p.previous_status:
            p.status = p.previous_status
            p.previous_status = None
    await db.commit()
    return await _load_owned_series_with_posts(db, series_id, user_id)
```

## 7. DELETE guards (FR-014, FR-016)

- `DELETE /api/v1/posts/{id}`:
  - Load the post.
  - If `status == "published"` → 409 `{error: "published_requires_archive",
    message: "Published posts cannot be deleted. Archive instead."}`.
  - Else hard-delete + cascade.
- `DELETE /api/v1/series/{id}`:
  - Load the series with its posts.
  - If any post's `status == "published"` → 409
    `{error: "series_has_published_posts",
    message: "Series has published posts and cannot be deleted. Archive the series instead."}`.
  - Else hard-delete (cascades posts via existing relationship).

## 8. PATCH behavior update (FR-010)

`PATCH /api/v1/posts/{id}` changes from 002:

- **Remove** the FR-005b guard that rejected platform change on
  series posts (Clarify-Q3 already removed FR-005a guard via schema
  absence; this removes the platform guard too).
- **Keep** the 15-min invariant re-check on `platform` or
  `scheduled_at` changes, now with archive-exclusion.
- **Add** sequential-integrity re-check: if the post has a
  `series_id` and the update changes `scheduled_at`, load all the
  series' posts ordered by `series_position`, replace this post's
  time with the new candidate, and run `check_sequential_integrity`.
  Reject with 409 `sequential_integrity_violation` if the swap
  breaks strict ordering.

## 9. Test matrix

| # | Case | File | Expectation |
|---|---|---|---|
| T1 | `check_platform_gap` excludes archived posts | `test_scheduling.py` | archived post does not block |
| T2 | Archive post → status = archived, previous_status set | `test_posts.py` | 200 + correct state |
| T3 | Unarchive post → previous_status restored, previous_status null | `test_posts.py` | 200 |
| T4 | Double-archive / double-unarchive | `test_posts.py` | 409 |
| T5 | DELETE published post | `test_posts.py` | 409 `published_requires_archive` |
| T6 | DELETE non-published post | `test_posts.py` | 204 |
| T7 | Templated series-create happy path | `test_series.py` | 201, 4 posts with `stage` set |
| T8 | Templated series-create with invalid stage order | `test_series.py` | 422 `invalid_stage_order` |
| T9 | Templated series-create with sequential-integrity violation | `test_series.py` | 409 `sequential_integrity_violation` |
| T10 | Templated series-create with 15-min collision against existing | `test_series.py` | 409 `platform_gap_conflict` + `series_post_index` |
| T11 | Templated series-create atomic abort (zero rows on failure) | `test_series.py` | count assertions |
| T12 | Archive series → series + all posts archived | `test_series.py` | 200 + state |
| T13 | Unarchive series → restore series + posts | `test_series.py` | 200 + state |
| T14 | DELETE series with published → 409 | `test_series.py` | 409 `series_has_published_posts` |
| T15 | DELETE series pre-execution → 204 | `test_series.py` | 204 |
| T16 | PATCH series post's platform now allowed (FR-005b removed) | `test_posts.py` | 200 with 15-min re-check |
| T17 | PATCH series post's scheduled_at breaks sequential integrity | `test_posts.py` | 409 `sequential_integrity_violation` |
| T18 | `include_archived=true` on list returns archived | `test_posts.py` | archived items included |
| T19 | `include_archived=false` on list excludes archived | `test_posts.py` | archived items excluded |
| T20 | `PostResponse.author` derived from owner.full_name | `test_posts.py` | asserted in response |

## 10. What's explicitly NOT in this 003 upgrade

- No `author` column (Clarify-Q3). Author is read-time derivation.
- No `canceled` status (Clarify-Q5).
- No "Show archived" toggle on the ListView (Clarify-Q4 — list always shows archived).
- No multi-user / sharing.
- No background publisher.
- No schema removals — every 002 column stays, even if unused by 003.
- No `Series.color` column — CCM hard-codes `#C7522A`; plan/impl stays with that constant for now. Can be added later.
