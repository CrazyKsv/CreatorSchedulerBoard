# Contract: `POST /api/v1/posts/{id}/publish`

**Feature**: 006-auto-publish-flow
**Status**: New endpoint — additive only.

## Purpose

Manual publish path for the post identified by `id`. Bypasses the series sequential predecessor rule (FR-015a) so a creator can publish a stage immediately, even if its predecessor isn't published yet.

## Request

- **Method**: `POST`
- **Path**: `/api/v1/posts/{id}/publish`
- **Path params**: `id` — integer post id.
- **Auth**: `Authorization: Bearer <jwt>` via the existing `get_current_user_id` dependency.
- **Body**: empty (no JSON body required). The endpoint accepts and ignores `Content-Length: 0`.

Convention follows the existing sibling actions on the same resource (`POST /api/v1/posts/{id}/archive`, `POST /api/v1/posts/{id}/unarchive`) for shape consistency (Principle X).

## Response — 200 OK (happy path)

The full updated `PostResponse`. After the call:

- `status` is `"published"`.
- `last_publish_attempt_at` and `last_publish_error` are both `null` (annotations clear on success).
- `scheduled_at` is unchanged (Assumption — preserved as the de-facto publish time).
- `published_url` is unchanged (still `null` until external-integration ships).

```json
{
  "id": 42,
  "title": "Spring Drop — Teaser",
  "platform": "instagram",
  "scheduled_at": "2026-04-30T13:00:00",
  "status": "published",
  "owner_id": 1,
  "series_id": 7,
  "series_position": 0,
  "body": "...",
  "published_url": null,
  "stage": "Teaser",
  "previous_status": null,
  "last_publish_attempt_at": null,
  "last_publish_error": null,
  "author": "alice@example.com",
  "created_at": "2026-04-24T11:00:00",
  "updated_at": "2026-04-24T16:32:11"
}
```

## Response — error cases

All error responses use the existing `{error, message, ...context}` envelope so the frontend's existing error-shaper (`src/api/client.js`) already handles them.

### 401 Unauthorized

Standard JWT auth failure. Reused from existing dependency.

### 404 Not Found

Returned when `id` does not exist OR is owned by a different user. Identity-leak prevention rule from FR-028 (existing). Body:

```json
{
  "error": "post_not_found",
  "message": "Post 42 not found."
}
```

### 409 Conflict — already published

```json
{
  "error": "already_published",
  "message": "Post 42 is already published."
}
```

This is **NOT** raised on a double-click race. A second concurrent request that arrives after the first has committed should see the post as `published` and is treated as a successful no-op (FR-014). 409 is only used when the caller explicitly knows the post is in a terminal state and submits anyway.

### 409 Conflict — terminal status

```json
{
  "error": "publish_not_allowed",
  "message": "Cannot publish a post in status \"archived\".",
  "current_status": "archived"
}
```

Raised when the post's current status is `archived` or `failed`. (Drafts and scheduled posts are valid sources for manual publish.)

### 500 Internal Server Error — DB write failed

After 3 in-tick retries, if the status flip still fails:

```json
{
  "error": "publish_internal_error",
  "message": "Could not publish post 42; the system will retry. Last attempt failed at 2026-04-24T16:32:00.",
  "last_publish_attempt_at": "2026-04-24T16:32:00",
  "last_publish_error": "transient database error"
}
```

The post remains `scheduled` (not `failed` — FR-019), the annotation columns are populated, and a subsequent retry from either the polling tick or another manual click may succeed. The 500 is the manual-publish-path mirror of the auto-publish failure annotation.

## Idempotency

Manual publish is idempotent in the success direction:

- First call: `scheduled` → `published`, returns 200.
- Second call (with the same id): observes the post is already `published`, returns 409 `already_published` if the caller is still trying to act, or returns 200 if the second call arrived before the first was visible. Either response is correct; the side effect (the post being `published`) is the same.

## Side effects

1. The post's `status` row is set to `"published"`.
2. The annotation columns (`last_publish_attempt_at`, `last_publish_error`) are reset to `NULL` on success.
3. Any armed publisher consideration of this row in the next polling tick is a no-op (the `WHERE status='scheduled'` predicate excludes it).
4. The publisher's catch-up sweep (FR-009b) runs immediately on this row's successor (in the same series at `series_position + 1`) if the successor's `scheduled_at` has already passed.

## Frontend wiring

- `frontend/src/api/client.js` adds `postsApi.publish(id)` calling this endpoint.
- `frontend/src/components/PostForm.jsx` shows the "Publish post" button when the loaded post's `status` is `draft` or `scheduled` (and not when it is `published` / `failed` / `archived`).
- Click → `ConfirmModal` prompt → on confirm → `postsApi.publish(id)` → on success, refresh `useScheduleData` and surface a "Published" toast.

## Tests required (Principle IX — Test-First)

Test file: `backend/tests/test_posts_publish_endpoint.py` (NEW). Must be written and failing before the handler lands. At minimum:

- Happy path: `scheduled` post → publish → 200 + `status="published"` + annotation columns NULL.
- Happy path from `draft` (no `scheduled_at`): same result.
- Sequential bypass: stage 2 of a series whose stage 1 is still `scheduled` → publish stage 2 manually → 200, stage 2 published, stage 1 unchanged.
- Auth failure (no JWT): 401.
- Wrong owner: 404 (not 403 — identity-leak rule).
- Terminal status — `archived` source: 409 `publish_not_allowed`.
- Already-published source: 409 `already_published`.
- Idempotency under concurrent calls: two concurrent requests, exactly one mutates, the other returns success-equivalent (200 or 409 `already_published`).
- Annotation clear: a post with `last_publish_error` set successfully publishes → both annotation columns return `null` in the response.
