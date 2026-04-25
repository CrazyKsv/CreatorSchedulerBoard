# Contract: `/api/v1/series`

Extends the 002 series contract with the 003 upgrade. All endpoints
require JWT auth and scope by `owner_id`.

## `POST /api/v1/series` — templated create endpoint

Creates a series + exactly 4 posts atomically using the fixed
Teaser → Announcement → Follow-up → Reminder template (FR-001..005).

**Request**:

```json
{
  "name": "Spring Launch",
  "description": "Teaser -> Reveal -> Follow-up -> Reminder",
  "stages": [
    { "stage": "Teaser",       "platform": "instagram", "title": "Something's coming.", "body": "...", "scheduled_at": "2026-05-01T09:00:00Z" },
    { "stage": "Announcement", "platform": "twitter",   "title": "April 29. 10am ET.",  "body": "...", "scheduled_at": "2026-05-02T10:00:00Z" },
    { "stage": "Follow-up",    "platform": "linkedin",  "title": "Quick recap",          "body": "...", "scheduled_at": "2026-05-05T11:00:00Z" },
    { "stage": "Reminder",     "platform": "instagram", "title": "Last call",            "body": "...", "scheduled_at": "2026-05-08T12:00:00Z" }
  ]
}
```

Constraints (Pydantic + endpoint):

- `name`: 1..255.
- `description`: optional, 0..1000.
- `stages`: exactly 4 items; `stages[i].stage` MUST equal the fixed
  label at position `i` (`Teaser / Announcement / Follow-up /
  Reminder`).
- Per-stage `title`: 1..255; `body`: optional, 0..5000.
- Per-stage `platform`: one of the 5 platform literals (may differ
  across stages — multi-platform series are supported; this
  supersedes 002's FR-005 single-platform-per-series clause).

**Response — 201**:

`SeriesResponse` with `posts[]` populated in position order. Each post
has its `stage`, `series_id`, `series_position` set. `status =
"scheduled"` by default on all 4.

**Errors**:

| Status | `detail.error` | When |
|---|---|---|
| 422 | Pydantic validation | Missing/invalid fields, wrong stage count, wrong stage order |
| 409 | `sequential_integrity_violation` | Any `stages[i].scheduled_at <= stages[i-1].scheduled_at` |
| 409 | `platform_gap_conflict` | Any stage collides with an existing non-archived post on the same platform (has `series_post_index`), OR two stages on the same platform are within 15 min of each other |
| 401 | — | Missing/invalid token |

Atomic abort: on any 409 or 422, ZERO rows are persisted. Counts of
`posts` and `series` must be unchanged.

## `GET /api/v1/series` — list (extended)

New query parameter:

| Param | Type | Default | Effect |
|---|---|---|---|
| `include_archived` | `bool` | `false` | When `false`, series with `status = 'archived'` are excluded. |

Response items include the new `status` and `previous_status` fields
added in 003.

## `GET /api/v1/series/{id}` — detail

Unchanged shape from 002; `SeriesResponse.posts[]` now carries the
new post fields added in 003 (body, stage, etc.).

## `PATCH /api/v1/series/{id}` — update

Same as 002: only `name`/`title` and `description` editable. `status`
is updated only through `/archive` and `/unarchive`.

## `DELETE /api/v1/series/{id}` — delete (guarded, FR-016)

- If ANY post in the series has `status == "published"` → **409**
  `{"detail": {"error": "series_has_published_posts", "message":
  "Series has published posts. Archive the series instead."}}`.
- Otherwise → `204` + cascade delete (unchanged from 002).

## `POST /api/v1/series/{id}/archive` — new (FR-017)

Transitions `series.status → archived` (preserves `previous_status`).
Cascades: for every child post with `status != "archived"`, set
`previous_status = status; status = "archived"`.

**Response** (200): full `SeriesResponse` (so the UI can render the
post states post-transition).

**Errors**:

| Status | `detail.error` | When |
|---|---|---|
| 409 | `already_archived` | series already archived |
| 404 | — | not found / not owned |

## `POST /api/v1/series/{id}/unarchive` — new

Restores `series.status = previous_status or "active"`, clears
`series.previous_status`. For every child post with
`status == "archived"` AND `previous_status != NULL`, restore its
`status = previous_status` and clear `previous_status`.

**Response** (200): full `SeriesResponse`.

**Errors**:

| Status | `detail.error` | When |
|---|---|---|
| 409 | `not_archived` | series not archived |
| 404 | — | not found / not owned |

## Compatibility with 002

- `POST /api/v1/series` accepts ONLY the 4-stage body. The 002
  cadence-based request shape (`cadence_unit`, `cadence_interval`,
  `post_count`, `start_at`) is RETIRED in 003 — no server-side
  translator, no deprecation header, no dual-support window. Plan
  rationale: the only client was the 002 frontend, which is deleted
  in this PR (see `plan.md` Complexity Tracking).
- Existing 002 series rows (cadence-based) that remain in the DB
  keep rendering — the `Series.platform` / `cadence_unit` /
  `cadence_interval` / `post_count` / `start_at` columns stay
  populated for read, and each child post has `stage = NULL`. The
  ListView renders legacy posts without a stage chip. No migration
  is run on those rows.

## Error shape parity (Principle X)

- `platform_gap_conflict` → same body shape as 002 FR-011, with
  optional `series_post_index` on series-create paths.
- `sequential_integrity_violation` → new body with
  `offending_post_index` and `prior_post_index` fields.
- `series_has_published_posts`, `published_requires_archive`,
  `already_archived`, `not_archived` → all follow the
  `{detail: {error, message}}` shape for UI consistency (Principle
  VII surfacing `detail.message` verbatim).
