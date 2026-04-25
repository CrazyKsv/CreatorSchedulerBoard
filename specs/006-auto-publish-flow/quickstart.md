# Quickstart — Manual verification

**Feature**: 006-auto-publish-flow
**Audience**: a reviewer who wants to confirm the spec-level acceptance scenarios in <10 minutes against a freshly-built local stack.

## Prereqs

- The branch `006-auto-publish-flow` is checked out.
- Implementation is complete (this is post-`/speckit.implement` validation).
- `docker compose up --build` is happy, OR you have the venv + Vite dev server running.
- A seeded user is logged in (default seed user: `alice@example.com` / `password123`).

## 1. Auto-publish at scheduled time (User Story 1, FR-001)

1. Open the dashboard. Note the "Published 7D" count in the hero — call it `N`.
2. Open the agent (Cmd+K) or the manual "New post" form. Create a single post on `instagram` with `scheduled_at` set 90 seconds from now and status `scheduled`.
3. Watch the post in the Upcoming rail or List view. Don't reload the page.
4. After ~75–90 seconds (publisher tick + heartbeat refetch combined), confirm the post's status badge reads "Published."
5. The hero "Published 7D" count is `N+1`.

**Pass**: status flipped without a manual reload, within 60 s of the scheduled time. Fails any of these: `not auto-promoted`, `requires reload`, or `late beyond 60 s`.

## 2. Catch-up after restart (FR-003)

1. Create a `scheduled` post 90 s in the future (same as above).
2. Immediately stop the backend (`docker compose stop backend`, or `Ctrl-C` the uvicorn process).
3. Wait 2 minutes.
4. Start the backend again.
5. Within 30 s of the backend becoming healthy, confirm the post is `published`.

**Pass**: the catch-up sweep ran on startup and published the overdue post. Fails: post still `scheduled` 30 s after restart.

## 3. Series sequential rule (FR-009a / FR-009b)

1. Open the agent and ask it to create a 4-stage Instagram series with stages 60/120/180/240 seconds out (or use the SeriesBuilder UI manually).
2. Wait. Stage 1 publishes around T+60 s.
3. **Before stage 2's time arrives**, archive stage 1 from the list view's row menu.
4. Wait through T+120, T+180, T+240.
5. Open the train-track view. Confirm stages 2, 3, 4 all stayed `scheduled` — none auto-published.
6. From the list view, click stage 1's row, choose Unarchive. Then open stage 1's edit form and click "Publish post" → confirm.
7. Within 60 s, stages 2, 3, 4 should auto-publish in order (FR-009b cascade) since their `scheduled_at` is now in the past and predecessors are now `published`.

**Pass**: stages stalled when predecessor was archived; cascade resumed when predecessor became `published`. Fails: any stage published while its predecessor was not `published`, or no cascade after manual unblock.

## 4. Manual publish with confirmation (User Story 2, FR-015 / FR-015b)

1. Open the post edit form for any `draft` or `scheduled` post.
2. Confirm the "Publish post" button is visible.
3. Click it. Confirm the modal appears with copy similar to "Publish this post now? This cannot be undone."
4. Click Cancel. Confirm the form is unchanged, the API was not called (check the network tab — no `POST /publish` request fired), and the post's status is unchanged.
5. Click "Publish post" again. This time, confirm the modal.
6. Within 2 s, confirm the post's status badge in the form flips to "Published," the "Publish post" button disappears, the status field becomes a read-only label, and the toast shows a success message.

**Pass**: confirm modal blocks one-click publish, cancel is a true no-op, confirm publishes within 2 s.

## 5. Status-dropdown lockdown (User Story 3, FR-016 / FR-018)

1. Open the post edit form for a `draft` post. Open the status dropdown.
2. Confirm the only options are `Draft`, `Scheduled`, `Archived`. **Not** `Published`. **Not** `Failed`.
3. From a terminal (or Postman), send:
   ```bash
   curl -X PATCH http://localhost:8000/api/v1/posts/<some-post-id> \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"status": "published"}'
   ```
4. Confirm the response is a 422 with a Pydantic literal-error detail listing the 3 allowed values.
5. Repeat with `"status": "failed"` — same 422.
6. For a post that is already `published`, open its edit form. Confirm the status field is rendered as a read-only label, not as an editable dropdown (FR-017).

**Pass**: dropdown shows 3 options; API rejects published / failed with 422; published posts show read-only status. Fails: any of those is wrong.

## 6. Internal-failure annotation (FR-007a / FR-007b)

This step requires injecting a failure. The simplest way is to temporarily make the publisher's commit fail in dev:

1. With the backend running, edit `backend/app/core/publisher.py` and uncomment the test-only failure injection (a `if int(os.getenv("FORCE_FAIL_NEXT_TICK", "0")) == 1: raise SQLAlchemyError(...)` block — added under the failure-injection helper section). Set `FORCE_FAIL_NEXT_TICK=1`.
2. Schedule a post 30 s in the future.
3. Wait through the next tick. The publisher exhausts its 3 retries. Watch the backend log: it should print a structured warning naming the post id and the exception.
4. Within the next dashboard refetch, confirm an amber warning row appears on the post: "Last auto-publish attempt failed at HH:MM:SS. The system will retry."
5. Reload the page. Confirm the annotation persists (the columns are stored; reload does not lose the warning).
6. Unset `FORCE_FAIL_NEXT_TICK`. Wait one more tick.
7. Confirm the post auto-publishes successfully and the warning disappears (annotation cleared per FR-007b).

**Pass**: annotation appears on failure, persists across reload, clears on success. Fails: silent failure (no annotation), or annotation persists after success.

## 7. End-to-end smoke

A 60-second sanity check before submitting:

1. `cd backend && pytest` — all green, including `test_publisher.py` and `test_posts_publish_endpoint.py`.
2. `cd frontend && npm run lint && npm test` — all green.
3. `docker compose up --build` finishes without errors.
4. Open the dashboard, schedule a post 30 s out, wait, confirm publish.
5. Click "Publish post" on a draft, confirm the modal flow works end-to-end.

If all 7 sections pass, the feature meets the spec.
