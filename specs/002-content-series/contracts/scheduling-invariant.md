# Contract: `check_platform_gap` (Principle III enforcement)

**Artifact**: `backend/app/core/scheduling.py` (new).

This is the authoritative interface every post-writing path must use.

## Signature

```python
async def check_platform_gap(
    db: AsyncSession,
    *,
    owner_id: int,
    platform: str,
    scheduled_at: Optional[datetime],
    exclude_post_id: Optional[int] = None,
) -> Optional[Conflict]:
    ...
```

**Returns**:

- `None` — the slot is clear; the caller may proceed.
- `Conflict(other_post_id, other_scheduled_at, delta_minutes)` — a
  collision was found; caller must raise 409.

## Semantics (binding)

| Property | Behavior |
|---|---|
| Null exemption | `scheduled_at is None` → returns `None` (drafts are exempt, FR-012). |
| Scope | `(owner_id, platform)`. Different owners or different platforms never collide. |
| Status scope | **All** posts with non-null `scheduled_at` are candidates, regardless of `status` (FR-008 amendment, Clarify-Q2). |
| Boundary | Strict-less-than: rejects `scheduled_at ∈ (existing − 15m, existing + 15m)`. Exactly 15 min apart is accepted. |
| Self-exclusion | When called during `PATCH /api/posts/{id}`, caller passes `exclude_post_id=post.id` so a post does not conflict with itself. |
| First-match semantics | Returns the first conflict found, not the closest. Callers rely on this + FR-011's "first conflict wins". |
| Side effects | None. Pure query. No writes. |

## Error shape produced by callers

Callers translate a non-null return into the 409 body specified in
`contracts/series-api.md` and FR-011:

```json
{
  "detail": {
    "error": "platform_gap_conflict",
    "message": "<human-readable>",
    "conflict_with_post_id": <int>,
    "conflict_with_scheduled_at": "<iso-8601>",
    "delta_minutes": <float>,
    "series_post_index": <int|absent>
  }
}
```

`series_post_index` is included only from the `POST /api/series` caller;
single-post callers omit it.

## Callers (enumerated)

1. `POST /api/posts` (`backend/app/api/posts.py`, `create_post`).
   - Before `db.add`: `check_platform_gap(db, owner_id=user_id, platform=data.platform, scheduled_at=data.scheduled_at)`.
2. `PATCH /api/posts/{id}` (`backend/app/api/posts.py`, `update_post`).
   - After loading the existing post, if `scheduled_at` OR `platform` is in the update payload AND the effective `scheduled_at` is non-null: call with `exclude_post_id=post.id`.
3. `POST /api/series` (`backend/app/api/series.py`, `create_series`).
   - For each of the N generated `scheduled_at` values: call without `exclude_post_id`. First non-null return → 409 + rollback (no-op since nothing has been added yet).
   - Additionally: pairwise sibling precheck on the N times using the same 15-min delta.

No other path currently writes `Post.scheduled_at`; `scripts/seed_data.py`
is a dev-only seeding utility and does **not** go through the invariant
(acceptable — it seeds a clean DB and its output matches the 15-min rule
by construction of the random distribution + minute-bucket rounding).

## Test obligations

The following tests MUST exist (Principle IV + Principle III):

| # | What it proves | Location |
|---|---|---|
| T1 | 10 min apart same platform → 409 | `test_posts.py` |
| T2 | Exactly 15 min apart same platform → 201 | `test_posts.py` |
| T3 | Same time different platform → both 201 | `test_posts.py` |
| T4 | Different owners same platform same time → both 201 | `test_scheduling.py` |
| T5 | PATCH self-exclusion → 200 | `test_posts.py` |
| T6 | PATCH moves into conflict → 409 | `test_posts.py` |
| T7 | Invariant sees posts of any status | `test_scheduling.py` |
| T8 | Series-create blocks on existing post → 409, zero writes | `test_series.py` |
| T9 | Series-create success populates all N posts | `test_series.py` |

## Why not DB-level constraints?

SQLite (and most SQL engines) cannot express "no two rows within a 15-min
window of each other on the same (owner, platform)" as a pure DDL
constraint. A trigger could, but:

- Triggers add complexity, are hard to test in isolation, and do not port
  cleanly if we migrate to Postgres.
- The app-level check keeps the logic readable and inspectable in Python
  code, which the constitution (Principle V) rewards.
- The app-level check is atomic within a single transaction for
  single-writer SQLite; good enough for v1.

Future consideration: when we migrate to Postgres (out of scope for this
PR), add a `SERIALIZABLE` transaction isolation and re-check at commit
time to guard against concurrent writers. The contract here does not
block that evolution.
