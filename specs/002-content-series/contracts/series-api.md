# Contract: `/api/series` endpoints

**Artifact**: `backend/app/api/series.py` (new), wired from `backend/app/main.py`.

All endpoints require the existing JWT auth dependency (`get_current_user_id`).
All requests and responses are JSON. Ownership scoping: the authenticated
user's id is used for every DB query's `owner_id` filter; other users'
series are never visible.

## `POST /api/series`

Create a series and atomically materialize N posts.

**Request body** (`SeriesCreate`):

```json
{
  "title": "Launch campaign",
  "description": "Teaser → announcement → follow-up → reminder",
  "platform": "instagram",
  "start_at": "2026-05-01T09:00:00Z",
  "cadence_unit": "weeks",
  "cadence_interval": 1,
  "post_count": 4
}
```

Constraints (validated by Pydantic before any DB work):

- `title`: 1..255 chars.
- `description`: optional, 0..1000 chars.
- `platform` ∈ `{youtube, instagram, twitter, tiktok, linkedin}`.
- `start_at`: ISO-8601 datetime (tz-aware recommended; naive treated as UTC).
- `cadence_unit` ∈ `{days, weeks}`.
- `cadence_interval` ∈ [1, 30].
- `post_count` ∈ [1, 20].

**Response — success (201)** — `SeriesResponse`:

```json
{
  "id": 17,
  "owner_id": 3,
  "title": "Launch campaign",
  "description": "Teaser → announcement → follow-up → reminder",
  "platform": "instagram",
  "start_at": "2026-05-01T09:00:00Z",
  "cadence_unit": "weeks",
  "cadence_interval": 1,
  "post_count": 4,
  "created_at": "2026-04-22T14:30:00Z",
  "updated_at": "2026-04-22T14:30:00Z",
  "posts": [
    { "id": 101, "title": "Launch campaign — part 1", "platform": "instagram",
      "scheduled_at": "2026-05-01T09:00:00Z", "status": "scheduled",
      "owner_id": 3, "series_id": 17, "series_position": 0, ... },
    { "id": 102, ..., "scheduled_at": "2026-05-08T09:00:00Z", "series_position": 1 },
    { "id": 103, ..., "scheduled_at": "2026-05-15T09:00:00Z", "series_position": 2 },
    { "id": 104, ..., "scheduled_at": "2026-05-22T09:00:00Z", "series_position": 3 }
  ]
}
```

**Response — conflict (409)** — shared shape with single-post conflicts
(FR-011 amendment):

```json
{
  "detail": {
    "error": "platform_gap_conflict",
    "message": "Another post (#42) on the same platform is scheduled 7 minutes after this one (at 2026-05-01T09:07:00Z).",
    "conflict_with_post_id": 42,
    "conflict_with_scheduled_at": "2026-05-01T09:07:00Z",
    "delta_minutes": 7.0,
    "series_post_index": 0
  }
}
```

Notes:
- `series_post_index` is present only on the series-create path; omitted or
  absent on single-post conflicts.
- First-conflict-wins: no list of conflicts returned.
- Zero rows are persisted on 409 (atomic abort).

**Response — validation error (422)**: standard FastAPI `ValidationError`
shape from Pydantic. Cadence-too-dense is treated as a 409 (business rule),
not 422 (input validation), so it uses the shape above.

**Response — auth failure (401)**: standard FastAPI auth error from the
existing dependency.

## `GET /api/series`

List the authenticated user's series. No pagination in v1.

**Response (200)** — `list[SeriesSummary]` (no embedded `posts`):

```json
[
  {
    "id": 17,
    "owner_id": 3,
    "title": "Launch campaign",
    "description": null,
    "platform": "instagram",
    "start_at": "2026-05-01T09:00:00Z",
    "cadence_unit": "weeks",
    "cadence_interval": 1,
    "post_count": 4,
    "created_at": "2026-04-22T14:30:00Z",
    "updated_at": "2026-04-22T14:30:00Z"
  }
]
```

Ordering: default `created_at DESC` (newest first).

## `GET /api/series/{id}`

Get one series including its posts ordered by `series_position`.

**Response — success (200)** — `SeriesResponse` (same shape as
`POST /api/series` success).

**Response — not found / cross-owner (404)**: returned for both
"series does not exist" and "series belongs to another user". No
information leak about existence.

## `PATCH /api/series/{id}`

Edit `title` and/or `description` only. All other fields immutable
(FR-005).

**Request body** (`SeriesUpdate`):

```json
{ "title": "Spring launch" }
```

Any additional fields sent by the client are silently ignored via
Pydantic's model-based parsing — consistent with the existing
`PATCH /api/posts/{id}` behavior.

**Response — success (200)**: `SeriesResponse` reflecting the updated
series (posts unchanged).

**Response — not found (404)**: as above.

## `DELETE /api/series/{id}`

Delete a series and cascade to its posts.

**Response — success (204)**: empty body.

**Response — not found (404)**: as above.

**Side effect**: every `Post` with `series_id == {id}` is removed in the
same transaction (SQLAlchemy `cascade="all, delete-orphan"`).

## Interactions with existing `/api/posts` endpoints

- `POST /api/posts` and `PATCH /api/posts/{id}` continue to work for
  standalone posts. They now additionally call `check_platform_gap` and
  return the same 409 shape on conflict.
- `PATCH /api/posts/{id}` will **not** mutate `series_id` or
  `series_position`. These fields are omitted from the `PostUpdate` schema
  (FR-005a).
- `PostResponse` gains two read-only fields (`series_id`,
  `series_position`) so the UI can display series context on every post.
- Deleting a series via `DELETE /api/series/{id}` also deletes every
  `Post` it owns. Deleting a single post that belongs to a series via
  `DELETE /api/posts/{id}` is allowed and leaves a gap in
  `series_position` — no renumbering in v1.

## Example flows

**Happy path**:

```text
POST /api/auth/login                     → 200  { access_token }
POST /api/series  { ... 4-post weekly }  → 201  { series with 4 posts }
GET  /api/series                         → 200  [ { summary } ]
GET  /api/series/17                      → 200  { detail with posts }
PATCH /api/series/17 { "title": "..." }  → 200  { updated }
DELETE /api/series/17                    → 204  (posts gone too)
```

**Conflict path**:

```text
POST /api/posts { "platform":"instagram", "scheduled_at":"...T09:05Z" }  → 201
POST /api/series { platform:"instagram", start_at:"...T09:00Z", weekly, 4 }
                                                                         → 409 (conflict_with_post_id=<that one>, delta_minutes=5, series_post_index=0)
```
