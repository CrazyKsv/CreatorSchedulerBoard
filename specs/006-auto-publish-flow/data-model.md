# Phase 1 Data Model

**Feature**: 006-auto-publish-flow

## New / changed columns

Two new nullable columns on the existing `posts` table. Nothing else changes. No new tables. No changes to `series`.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `last_publish_attempt_at` | DateTime (tz-aware UTC, naive on read per existing convention) | yes | NULL | Wall-clock time of the most recent **failed** auto-publish attempt for this post. NULL means "no failed attempt outstanding." Cleared back to NULL on a successful publish (auto or manual). |
| `last_publish_error` | String (≤64 chars) | yes | NULL | Short stable error code from the fixed set defined under "`last_publish_error` value contract" below. NULL whenever `last_publish_attempt_at` is NULL. The frontend renders friendly copy keyed off the code; it does NOT show this value verbatim. |

The two columns are kept in sync: either both are NULL (no outstanding failure annotation) or both are set (a failure annotation is active). They never get into a half-set state.

### Migration

Idempotent `ALTER TABLE` on startup, guarded by `PRAGMA table_info`. Pattern matches the 002 migration. No drop / recreate.

```sql
ALTER TABLE posts ADD COLUMN last_publish_attempt_at DATETIME;
ALTER TABLE posts ADD COLUMN last_publish_error VARCHAR(256);
```

## Pydantic schemas

### `PostStatusUserSettable` (NEW)

A `Literal` type narrowing the existing `PostStatus` enum to the values a client may send via `POST /api/v1/posts` and `PATCH /api/v1/posts/{id}`:

```python
PostStatusUserSettable = Literal["draft", "scheduled", "archived"]
```

Used as the type of the `status` field on:

- `PostCreate`
- `PostUpdate`

`published` and `failed` are NOT in this Literal. Pydantic rejects them at request-validation time with a 422 detail listing the allowed values; the API handler does not see them. (FR-018)

### `PostResponse` (extended)

Two additive fields:

```python
class PostResponse(BaseModel):
    # ... existing fields ...
    last_publish_attempt_at: Optional[datetime] = None
    last_publish_error: Optional[str] = None
```

Both are present on every response and are `None` for posts that have no outstanding failure annotation. Existing clients that ignore unknown fields continue to work (Principle X — additive-only).

### `PostStatus` enum (UNCHANGED)

The full enum (`draft`, `scheduled`, `published`, `failed`, `archived`) is preserved on the model, the response, and internal code paths. `published` and `failed` simply become server-only outputs; the schemas just stop letting clients write them.

## State-transition table

Subjects: a post's lifecycle. Trigger: who or what causes the transition.

| From → To | Triggered by | Allowed | Notes |
|---|---|---|---|
| (new) → `draft` | client (POST /posts) | ✓ | Default on create when `status` is omitted or `"draft"`. |
| (new) → `scheduled` | client (POST /posts) | ✓ | When `status="scheduled"` and `scheduled_at` is set + future-or-past per existing 003 rules + 15-min gap respected. |
| (new) → `archived` | client (POST /posts) | ✓ (legacy use) | Allowed for completeness; not the primary archive path. |
| `draft` → `scheduled` | client (PATCH) | ✓ | Existing behavior. |
| `scheduled` → `draft` | client (PATCH) | ✓ | Existing behavior. |
| `scheduled` → `published` | publisher (auto) | ✓ | The headline new transition (FR-001). Subject to FR-009a series sequential rule. |
| `scheduled` → `published` | publisher (manual via POST /publish) | ✓ | FR-015. Bypasses sequential rule (FR-015a). |
| `draft` → `published` | publisher (manual via POST /publish) | ✓ | Manual publish from a draft. |
| `*` → `published` | client (PATCH or POST direct status set) | ✗ | Rejected at schema validation by `PostStatusUserSettable` (FR-018). |
| `*` → `failed` | client | ✗ | Same. Reserved for backend (FR-019). |
| `*` → `failed` | publisher | (reserved) | Today: not triggered. The publisher does not promote a post to `failed`. The hook exists for future external-integration failures only. |
| `*` → `archived` | client (POST /posts/{id}/archive) | ✓ | Existing dedicated endpoint, unchanged. |
| `archived` → `<prev>` | client (POST /posts/{id}/unarchive) | ✓ | Existing endpoint; restores previous status. |
| `published` → `archived` | client (POST /posts/{id}/archive) | ✓ | Existing — published posts can be archived. |
| `published` → `<anything else>` | any | ✗ | Published is terminal except for archive. (Existing rule.) |

### Series sequential rule (FR-009a)

For posts where `series_id IS NOT NULL`, the publisher's `scheduled → published` auto-transition has an additional precondition: the predecessor post in the same series (same `series_id`, `series_position = self.series_position - 1`) must be `published`. Otherwise the auto-publish is **skipped**, the post stays `scheduled`, and a `last_publish_error = "predecessor not yet published"` annotation is written.

For `series_position = 0` there is no predecessor — auto-publish proceeds unconditionally.

Manual publish via `POST /api/v1/posts/{id}/publish` does **not** check the predecessor (FR-015a).

### Catch-up on predecessor unblock (FR-009b)

When the publisher transitions a post P at position N to `published` (whether by auto-publish or manual publish), it MUST sweep for any successor post S in the same series at position N+1 whose `status='scheduled'` and `scheduled_at <= now_est`, and run S through the publish step in the same tick (or queue it for the next tick at the latest). This makes the catch-up cascade promised in spec acceptance scenario 7.

## `last_publish_error` value contract

The column stores one of a small fixed set of short string codes. The frontend MUST render a friendly UI message keyed off the code rather than displaying the raw value. This keeps the wire format stable, lets us update copy independently of the backend, and avoids leaking implementation strings into the UI.

| Code | Trigger | UI rendering |
|---|---|---|
| `transient_database_error` | A DB write (commit) raised an exception after the publisher exhausted its 3 in-tick retries (1s / 2s / 4s backoff). | "Last auto-publish attempt failed at HH:MM. The system will retry." |
| `predecessor_not_published` | FR-009a — series stage's `series_position - 1` predecessor was not in `published` when the tick reached the post. | "Waiting on the previous stage to publish before this one runs." |
| `unknown_internal_error` | Catch-all for any error class the publisher does not classify above. | "Last auto-publish attempt failed unexpectedly. The system will retry." |

**Forward compatibility**: the frontend MUST treat any unrecognized code as if it were `unknown_internal_error` (render the catch-all copy). Adding new codes later therefore does not break older frontend builds.

**Atomic write**: the publisher writes `last_publish_attempt_at = utcnow()` and `last_publish_error = <code>` in the same transaction. Both columns are reset to NULL atomically on the next successful publish for the same row.

## Failure-annotation lifecycle

```
[no annotation: both columns NULL]
      |
      | publisher attempt fails (3x retry inside tick exhausted)
      v
[annotation set: last_publish_attempt_at = now, last_publish_error = "..."]
      |
      | next tick re-attempts same post
      |
      ├─ success → status="published", BOTH columns reset to NULL
      |
      └─ failure → both columns updated to the latest attempt + error
```

The annotation never leaks into the `published` state. A post is either:

- `scheduled` + no annotation (clean state),
- `scheduled` + annotation (last attempt failed, will retry),
- `published` + no annotation (success — even if previous attempts had failed).

## Indexes

The publisher's primary query is:

```sql
SELECT id, owner_id, platform, scheduled_at, series_id, series_position
  FROM posts
 WHERE status = 'scheduled'
   AND scheduled_at <= :now
 ORDER BY scheduled_at;
```

The existing `posts(status)` index (already present from 002) covers the status filter. No new index is required.

If the test suite or a future scale review shows hot-spotting, a partial index `CREATE INDEX ON posts(scheduled_at) WHERE status='scheduled'` is the obvious next step. Not added now.

## Validation rules summary

- `last_publish_attempt_at` and `last_publish_error` are populated only by the publisher and only via `POST /api/v1/posts/{id}/publish` failure paths (manual publish that hits the same DB write also sets them on failure). No client may write either field directly. (Pydantic schemas exclude both from `PostCreate` and `PostUpdate`.)
- The publisher MUST NOT alter any field on `posts` other than `status`, `last_publish_attempt_at`, and `last_publish_error` during the publish operation. In particular, `scheduled_at`, `body`, `series_id`, `series_position` are immutable from the publisher's perspective.
- Once a post is `published`, the publisher MUST NOT touch it again. Idempotency is enforced by the `WHERE status='scheduled'` clause on the candidate query.
