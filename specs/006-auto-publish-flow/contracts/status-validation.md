# Contract: Status validation on `POST /api/v1/posts` and `PATCH /api/v1/posts/{id}`

**Feature**: 006-auto-publish-flow
**Status**: Backwards-compatible tightening of existing endpoints.

## What changes

The `status` field on `PostCreate` and `PostUpdate` Pydantic schemas changes its type from the full `PostStatus` enum to the new narrower `PostStatusUserSettable` Literal:

```python
PostStatusUserSettable = Literal["draft", "scheduled", "archived"]
```

Effect:

- Clients sending `status="draft"`, `"scheduled"`, or `"archived"` continue to work exactly as before.
- Clients sending `status="published"` or `status="failed"` get a 422 from FastAPI's request validator listing the allowed values (FR-018, FR-019, FR-020).

The `PostStatus` enum on the model and on `PostResponse` is unchanged — server code can still produce, query, and read every status value. This is purely about which strings clients are permitted to write.

## Backwards-compatibility notes

- **Additive in spirit, restrictive in surface area.** Principle X allows additive changes; this is the only safe form of restriction we can apply because Pydantic-side narrowing is the cleanest enforcement point. The PR description must call this out: any prior client that depended on PATCHing `status="published"` will start receiving a 422.
- **No prior client did this legitimately.** A client that wanted to publish should not have been sending `status="published"` via `PATCH` — that contradicts the current spec's intent. The new restriction makes the previous loophole impossible.
- **Existing tests that did this break.** `backend/tests/test_posts.py` includes happy-path tests where the test fixture sets `status="published"`. Those tests will be updated to use the new `POST /api/v1/posts/{id}/publish` endpoint instead, which is the actual supported path now. (See `tasks.md` once `/speckit.tasks` runs.)

## Request — `POST /api/v1/posts` (relevant changes only)

**Allowed `status` values**: `"draft"` (default), `"scheduled"`, `"archived"`.

**Disallowed**: `"published"`, `"failed"`. Pydantic returns:

```json
{
  "detail": [
    {
      "type": "literal_error",
      "loc": ["body", "status"],
      "msg": "Input should be 'draft', 'scheduled' or 'archived'",
      "input": "published",
      "ctx": {"expected": "'draft', 'scheduled' or 'archived'"}
    }
  ]
}
```

(Standard Pydantic 422 shape. The frontend's error shaper already handles this — Principle VII / X.)

## Request — `PATCH /api/v1/posts/{id}` (relevant changes only)

Same allowed values, same rejection shape. PATCH is the more common attack surface for the lockdown (a client editing a post and trying to "set status to published" is the path FR-018 explicitly closes).

## Response — `GET /api/v1/posts` and `GET /api/v1/posts/{id}` (read paths)

Two new fields on `PostResponse`:

```python
class PostResponse(BaseModel):
    # ... existing fields ...
    last_publish_attempt_at: Optional[datetime] = None
    last_publish_error: Optional[str] = None
```

Default `null` for the entire historical post population (the migration leaves them NULL on all existing rows). Existing clients that don't know about these fields ignore them.

## Frontend wiring

Three places in `frontend/src/components/PostForm.jsx` change:

1. **Status dropdown options**: filtered to `["draft", "scheduled", "archived"]`. The select's `<option>` list excludes `"published"` and `"failed"`. (FR-016)
2. **Read-only status display for terminal states**: when the loaded post's status is `"published"` or `"failed"`, the form replaces the dropdown with a labeled read-only chip (e.g., `Status: Published`). The user cannot edit it from the form. (FR-017)
3. **No silent truncation of the response**: the form continues to render every other field exactly as today. The two new annotation fields (`last_publish_attempt_at`, `last_publish_error`) are surfaced as a small inline warning when present.

The `PostCard` and `SeriesCard` components add the same warning indicator on the per-post tile so the user sees the failure annotation without opening the form (matches FR-007a's "list / track views" requirement).

## Tests required (Principle IX — Test-First)

Tests get **added to** the existing `backend/tests/test_posts.py`. Test-First applies to the new rejection paths:

- `POST /api/v1/posts` with `status="published"` → 422 with the literal-error detail above.
- `POST /api/v1/posts` with `status="failed"` → 422.
- `POST /api/v1/posts` with `status="draft"` → 201 (regression — still works).
- `POST /api/v1/posts` with `status="scheduled"` and a valid `scheduled_at` → 201.
- `POST /api/v1/posts` with `status="archived"` → 201 (legacy use; preserved).
- `PATCH /api/v1/posts/{id}` with `status="published"` → 422.
- `PATCH /api/v1/posts/{id}` with `status="failed"` → 422.
- `PATCH /api/v1/posts/{id}` with `status="draft"` (from `scheduled`) → 200; downstream `posts.scheduled_at` is preserved per existing semantics.
- `GET /api/v1/posts/{id}` for a post with no failure annotation → response includes both new fields with `null` values.
- `GET /api/v1/posts/{id}` for a post the publisher has annotated → response includes both new fields populated.

## Frontend tests

`frontend/src/components/PostForm.test.jsx` (NEW):

- Status dropdown for a post with `status="draft"` shows exactly 3 options: Draft, Scheduled, Archived. No "Published," no "Failed."
- Form for a post with `status="published"` shows the status as a read-only label, no dropdown.
- A post with `last_publish_error` set renders an amber warning row with the error text + the timestamp from `last_publish_attempt_at`.
- Cancelling the Publish confirmation modal does not call the publish API.
- Confirming the modal calls `postsApi.publish(id)` exactly once and refreshes the page state.
