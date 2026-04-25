# Contract: `/api/v1/posts`

Extends the 002 post contract. All endpoints continue to require the
existing JWT auth dependency and scope results to the authenticated
`owner_id`.

## `GET /api/v1/posts` — list (extended)

New query parameter:

| Param | Type | Default | Effect |
|---|---|---|---|
| `include_archived` | `bool` | `false` | When `false`, posts with `status = 'archived'` are excluded. When `true`, they are included in the response. |

Existing `status` / `platform` filters still work and compose with
`include_archived` (e.g., `?include_archived=true&status=archived`
returns only archived posts).

Response items now include the new fields added in 003:

```json
{
  "id": 42, "title": "...", "platform": "instagram",
  "scheduled_at": "2026-05-01T09:00:00Z", "status": "scheduled",
  "owner_id": 3, "series_id": 17, "series_position": 0,
  "stage": "Teaser",
  "body": "Moody 9-grid teaser — no product visible yet.",
  "published_url": null,
  "previous_status": null,
  "author": "Alice Creator",
  "created_at": "...", "updated_at": "..."
}
```

`author` is derived at serialization time from the authenticated
owner's `full_name` (falls back to `email` if null). NOT a stored
column.

## `POST /api/v1/posts` — create (extended)

`PostCreate` now accepts an optional `body` field (text, ≤ 5000 chars).
All other 002 behavior is unchanged — including the 15-min invariant
call and 409 response shape.

## `PATCH /api/v1/posts/{id}` — update (updated rules for 003)

Accepted fields: `title`, `platform`, `scheduled_at`, `status`, `body`.
NOT accepted: `series_id`, `series_position`, `stage`, `previous_status`,
`published_url`, `author`.

Changes from 002:

- **FR-005b removed** — platform CAN now change on a post that belongs
  to a series. The series' `platform` column becomes a cosmetic
  display hint (not authoritative for child posts).
- **FR-020 added** — if the post is a series-child and
  `scheduled_at` is being changed, the server re-validates the
  series' Sequential Integrity by substituting the new time into the
  ordered list of sibling times. On violation, return 409
  `sequential_integrity_violation`.
- **FR-018 applied** — the 15-minute invariant excludes archived
  posts from the conflict set.

Error bodies:

| Status | `detail.error` | When |
|---|---|---|
| 409 | `platform_gap_conflict` | 15-min rule violated (shape unchanged from 002 FR-011) |
| 409 | `sequential_integrity_violation` | Series child time breaks strict ordering (new) |
| 400 | `invalid_field` | Client sent a field not accepted by `PostUpdate` |
| 404 | — | Post not found or not owned |

## `DELETE /api/v1/posts/{id}` — delete (guarded)

- If `status ∈ {draft, scheduled, failed}` → `204` + hard delete (unchanged from 002).
- If `status == "published"` → **409** `{"detail": {"error":
  "published_requires_archive", "message": "Published posts cannot
  be deleted. Use archive instead."}}`.
- If `status == "archived"` → `204` + hard delete (archiving is
  already the soft state; user may hard-delete the archived row).

## `POST /api/v1/posts/{id}/archive` — new

Transitions `status` to `archived` (preserves `previous_status`).

**Request**: empty body.

**Response** (200): `PostResponse` with updated status.

**Errors**:

| Status | `detail.error` | When |
|---|---|---|
| 409 | `already_archived` | status already `archived` |
| 404 | — | post not found or not owned |

## `POST /api/v1/posts/{id}/unarchive` — new

Transitions `status` back to `previous_status`; clears `previous_status`.

**Request**: empty body.

**Response** (200): `PostResponse` with restored status.

**Errors**:

| Status | `detail.error` | When |
|---|---|---|
| 409 | `not_archived` | status is not `archived` |
| 404 | — | post not found or not owned |

## Interactions

- `POST /api/v1/posts/{id}/archive` + `POST /api/v1/posts/{id}/unarchive`
  round-trip MUST be lossless: archiving then unarchiving returns
  `status` to its original value.
- Archived posts are not candidates for the 15-min invariant check —
  creating a new post in the same slot as an archived post is allowed.
- The shared `_raise_platform_gap_conflict` helper continues to
  produce the FR-011 body shape on all platform-gap conflicts.
