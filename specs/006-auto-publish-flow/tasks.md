---

description: "Task list for feature 006-auto-publish-flow"
---

# Tasks: Auto-Publish Flow & Status Transition Lockdown

**Input**: Design documents from `/specs/006-auto-publish-flow/`
**Prerequisites**: `plan.md`, `spec.md` (with Clarifications), `research.md`, `data-model.md`, `contracts/publish-endpoint.md`, `contracts/status-validation.md`, `quickstart.md`.
**Tests**: REQUIRED for every backend API endpoint and core scheduling module touched in this feature (Principle IX — Test-First, NON-NEGOTIABLE). Tests MUST be written and made to fail before the matching implementation task lands. Frontend tests are scoped to PostForm and the failure-annotation render.

**Organization**: Tasks are grouped by user story (US1 / US2 / US3 from `spec.md`). Each story is independently testable per the spec.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks within the same phase (different files, no in-phase dependencies).
- **[Story]**: User story label (US1 / US2 / US3). Setup, Foundational, and Polish tasks have no story label.
- All file paths are repository-root-relative.

## Path Conventions

Web app, two-tree layout:
- Backend: `backend/app/`, `backend/tests/`
- Frontend: `frontend/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: This feature is an extension to an existing repo; no new project scaffolding is required. Setup is limited to confirming the active branch and clean working tree before implementation begins.

- [X] T001 Confirm working tree is clean and the active branch is `006-auto-publish-flow` (commit any in-progress unrelated changes before this feature begins). No file edits — verification only.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema additions and shared response-shape changes that every user story depends on. NO user story work can begin until this phase is complete.

- [X] T002 Add two new nullable columns `last_publish_attempt_at` (DateTime, tz-aware) and `last_publish_error` (String(256)) to the `Post` ORM model in `backend/app/models/post.py`. Defaults are `None` (NULL). Update `__repr__` if relevant.
- [X] T003 Add an idempotent startup migration in `backend/app/main.py` (alongside the existing 002/003 PRAGMA-guarded `ALTER TABLE` blocks) that adds the two columns to the `posts` table when they're absent. Pattern matches `if 'last_publish_attempt_at' not in {col['name'] for col in await db.execute(text('PRAGMA table_info(posts)'))}: ...`.
- [X] T004 [P] Extend `PostResponse` in `backend/app/schemas/post.py` to include `last_publish_attempt_at: Optional[datetime] = None` and `last_publish_error: Optional[str] = None`. Verify the ORM-mode mapping picks the new columns up automatically.

**Checkpoint**: Schema changes committed; `pytest backend/tests/` passes (no behavior change yet — failure annotations are always NULL until the publisher writes them). User stories can now begin.

---

## Phase 3: User Story 1 - Scheduled posts auto-publish at the right time (Priority: P1) 🎯 MVP

**Goal**: Posts in `status='scheduled'` whose `scheduled_at` has elapsed transition automatically to `status='published'` within 60 seconds, surviving server restarts and respecting the series sequential predecessor rule.

**Independent Test**: Schedule a post 60 seconds in the future on a clean dataset; wait; confirm via `GET /api/v1/posts/{id}` and the dashboard UI that its status is `published` and that no manual action was taken. Restart the backend mid-wait and confirm the publish still occurs (catch-up).

### Tests for User Story 1 (Test-First — Principle IX) ⚠️

> Write these tests FIRST, ensure they FAIL on `main` (no `publisher.py`), then implement T010 to make them pass.

- [X] T005 [P] [US1] Create `backend/tests/test_publisher.py` with the test scaffolding (fixtures for `AsyncSessionLocal`, a `freeze_now` helper, and a `run_one_tick(...)` test entrypoint that invokes the publisher's tick function exactly once). All tests below live in this file and run sequentially per pytest's default within-file ordering.
- [X] T006 [US1] Add `test_tick_publishes_due_scheduled_post` to `backend/tests/test_publisher.py` — a single `scheduled` post with `scheduled_at = now - 1s` becomes `status='published'` after one tick; `last_publish_attempt_at` and `last_publish_error` remain NULL.
- [X] T007 [US1] Add `test_tick_does_not_publish_future_post` to `backend/tests/test_publisher.py` — a `scheduled` post with `scheduled_at = now + 60s` is left untouched after a tick.
- [X] T008 [US1] Add `test_tick_catchup_after_restart` to `backend/tests/test_publisher.py` — multiple `scheduled` posts whose `scheduled_at` are all in the past (simulating a long downtime) are all published in a single tick within the SC-004 budget.
- [X] T009 [US1] Add `test_tick_skips_when_predecessor_not_published` to `backend/tests/test_publisher.py` — a series with stage 1 in `scheduled` (still future) and stage 2 due now → stage 2 is skipped, stays `scheduled`, and gets `last_publish_error = "predecessor not yet published"`. Stage 1 is untouched.
- [X] T010 [US1] Add `test_tick_cascades_when_predecessor_unblocks` to `backend/tests/test_publisher.py` — series with all 4 stages overdue and stage 1 currently `scheduled`. After publishing stage 1, the same tick (or the next) cascades through stages 2/3/4 in `series_position` order per FR-009b.
- [X] T011 [US1] Add `test_tick_retry_then_succeed` to `backend/tests/test_publisher.py` — patch `AsyncSession.commit` to raise `SQLAlchemyError` on the first attempt and succeed on the second. Confirm the post ends up `published` after one tick and the annotation columns are NULL on success.
- [X] T012 [US1] Add `test_tick_retry_exhausted_writes_annotation` to `backend/tests/test_publisher.py` — patch commit to raise on all 3 attempts. Confirm the post stays `scheduled`, both annotation columns are populated (`last_publish_attempt_at` ≈ now, `last_publish_error` is a short readable string), and the post will be retried on the next tick.
- [X] T013 [US1] Add `test_tick_idempotent_on_published_row` to `backend/tests/test_publisher.py` — a post in `published` is invisible to the tick query (`WHERE status='scheduled'`), so the tick does nothing on it. Run two ticks back-to-back and confirm no `updated_at` change.
- [X] T013a [US1] Add `test_tick_skips_archived_post` and `test_tick_handles_deleted_post` to `backend/tests/test_publisher.py` — explicit coverage for FR-005. The first case archives a `scheduled` post whose `scheduled_at` is in the past, runs a tick, and asserts the post stays `archived`. The second case deletes a row mid-flight (between candidate-query and per-row publish call) and asserts the tick logs the missing row and continues to the next candidate without raising.

### Implementation for User Story 1

- [X] T014 [US1] Implement `backend/app/core/publisher.py` — a single module exposing `start_publisher(app: FastAPI)` and `stop_publisher()` that drive an `asyncio` polling loop. The loop wakes every `TICK_INTERVAL_SECONDS = 15`, queries `select(Post).where(Post.status == 'scheduled', Post.scheduled_at <= now_est())` ordered by `scheduled_at`, runs each row through a `_publish_one(post)` helper. Borrow the file structure from `005-auto-publish-scheduled:backend/app/core/publisher.py` but DROP the SSE/event-fanout layer. Honor FR-009a (sequential predecessor check), FR-009b (after publish, sweep successors in same series whose `scheduled_at` ≤ now), in-tick retry (3 attempts, 1s/2s/4s backoff), and the annotation-write/clear contract from `data-model.md`.
- [X] T015 [US1] Wire `start_publisher(app)` into FastAPI's `lifespan` context manager in `backend/app/main.py` so it starts on app startup and is cancelled on shutdown. The lifespan handler MUST await the publisher task's cancellation before returning so tests don't observe leaked tasks.
- [X] T016 [P] [US1] Extend `frontend/src/hooks/useScheduleData.js` with a 30-second `setInterval` heartbeat that calls `fetchAll()`. Pause when `document.visibilityState !== 'visible'`; resume on `visibilitychange`. Clean up the interval on unmount.
- [X] T017 [P] [US1] In `frontend/src/components/PostCard.jsx`, render an inline amber warning row (reuse `.ns-banner-warning` from `index.css`) when `post.last_publish_attempt_at` is non-null. Copy: "⚠ Last auto-publish attempt failed at HH:MM:SS — will retry."
- [X] T018 [P] [US1] In `frontend/src/components/SeriesCard.jsx`, render the same warning per-stage tile when the child post has `last_publish_attempt_at` set. In `frontend/src/components/FeaturedSeriesCard.jsx`'s `StageTile`, render a small "⚠" overlay icon on tiles whose post has the annotation. Tooltip on hover shows the same copy.

**Checkpoint**: User Story 1 is functional end-to-end. A reviewer can run quickstart.md §1 and §2 and observe the auto-publish + catch-up behavior. Phase 3 closes here.

---

## Phase 4: User Story 2 - Creator can publish a post on demand (Priority: P2)

**Goal**: A creator can click "Publish post" on the post edit form and immediately publish a `draft` or `scheduled` post, gated by a confirmation modal, with the UI updating within 2 seconds. Manual publish bypasses the series sequential rule (FR-015a).

**Independent Test**: Open a draft post in the edit form, click "Publish post," confirm the modal, and verify the status reads "Published" within 2 seconds in the form, the list view, and via `GET /api/v1/posts/{id}`. Do the same for a `scheduled` series stage whose predecessor is unpublished — verify it publishes (sequential bypass).

### Tests for User Story 2 (Test-First — Principle IX) ⚠️

- [X] T019 [US2] Create `backend/tests/test_posts_publish_endpoint.py` with the fixture scaffolding (auth header, seeded posts/series).
- [X] T020 [US2] Add `test_publish_scheduled_post_succeeds` to `backend/tests/test_posts_publish_endpoint.py` — `POST /api/v1/posts/{id}/publish` on a `scheduled` post returns 200, body's `status='published'`, both annotation columns NULL.
- [X] T021 [US2] Add `test_publish_draft_post_succeeds` to `backend/tests/test_posts_publish_endpoint.py` — `POST /api/v1/posts/{id}/publish` on a `draft` post (no `scheduled_at`) returns 200, `status='published'`.
- [X] T022 [US2] Add `test_publish_bypasses_sequential_rule` to `backend/tests/test_posts_publish_endpoint.py` — a series with stage 1 in `scheduled` (predecessor not published) and stage 2 also `scheduled`. Manually publishing stage 2 returns 200 + `published`; stage 1 is unchanged.
- [X] T023 [US2] Add `test_publish_unauthenticated_returns_401` to `backend/tests/test_posts_publish_endpoint.py` — no JWT → 401.
- [X] T024 [US2] Add `test_publish_other_owners_post_returns_404` to `backend/tests/test_posts_publish_endpoint.py` — alice's JWT trying to publish bob's post → 404 (identity-leak rule, NOT 403).
- [X] T025 [US2] Add `test_publish_archived_or_failed_returns_409` to `backend/tests/test_posts_publish_endpoint.py` — `archived` source → 409 `publish_not_allowed`. `failed` source → same 409.
- [X] T026 [US2] Add `test_publish_already_published_is_idempotent` to `backend/tests/test_posts_publish_endpoint.py` — second consecutive call against the same id is treated as either a 200 (idempotent success) or 409 `already_published`. Either is acceptable per `contracts/publish-endpoint.md`. Both responses must leave the post `published`.
- [X] T027 [US2] Add `test_publish_clears_existing_failure_annotation` to `backend/tests/test_posts_publish_endpoint.py` — pre-seed a `scheduled` post with both annotation columns populated. Manually publish it. Confirm the response shows both columns NULL after publish.

### Implementation for User Story 2

- [X] T028 [US2] In `backend/app/api/posts.py`, add a new handler `async def publish_post(...)` mounted at `@router.post("/{post_id}/publish", response_model=PostResponse)`. Use the same `_load_owned_post(...)` helper for ownership scoping. Reject `archived`/`failed`/`published` sources with the 409 shapes documented in `contracts/publish-endpoint.md`. Reuse the publisher's `_publish_one(...)` helper from `backend/app/core/publisher.py` so the annotation-clear-on-success contract is implemented in one place. Run inside a transaction.
- [X] T029 [P] [US2] In `frontend/src/api/client.js`, add `postsApi.publish(id)` calling `POST /api/v1/posts/{id}/publish` with the existing auth header. Surface FastAPI/Pydantic errors via the same `apiError` shaper used for other endpoints.
- [X] T030 [P] [US2] In `frontend/src/components/PostForm.jsx`, add a "Publish post" button to the form's action row when `formData.status in ('draft', 'scheduled')`. Hide it when status is `published`/`failed`/`archived`. Style as a primary action consistent with existing `.ns-btn-primary`.
- [X] T031 [US2] In `frontend/src/components/PostForm.jsx`, wire the click handler: open `ConfirmModal` (reuse the existing component) with copy "Publish this post now? This cannot be undone." Cancel = no-op; Confirm = call `postsApi.publish(formData.id)`, then on success: call the parent's refresh callback, surface a "Post published" toast, close the form. On error: surface the error message via the existing toast / banner pattern; leave the modal closed.

**Checkpoint**: User Story 2 is functional. Quickstart §4 passes — confirm modal blocks one-click, cancel is a true no-op, confirm publishes within 2 s.

---

## Phase 5: User Story 3 - Status dropdown only offers user-controllable values (Priority: P3)

**Goal**: The status dropdown on the post create/edit form omits `published` and `failed`. The API rejects any client request that tries to set those values via `POST` or `PATCH /api/v1/posts`. Posts already in `published` or `failed` show their status as a read-only label, not a dropdown.

**Independent Test**: Open the post edit form for a draft post and confirm the status dropdown shows exactly `Draft / Scheduled / Archived`. Send a `PATCH` with `status='published'` via curl and confirm a 422 with the Pydantic literal-error detail.

### Tests for User Story 3 (Test-First — Principle IX) ⚠️

- [X] T032 [P] [US3] Augment `backend/tests/test_posts.py` with `test_create_post_rejects_published_status` — `POST /api/v1/posts` with `status='published'` returns 422; the `detail` array's first entry has `loc=['body','status']` and `type='literal_error'`.
- [X] T033 [P] [US3] Augment `backend/tests/test_posts.py` with `test_create_post_rejects_failed_status` — same shape, value `failed`.
- [X] T034 [P] [US3] Augment `backend/tests/test_posts.py` with `test_create_post_accepts_draft_scheduled_archived` — regression: each of those values returns 201 (with appropriate scheduled_at where required).
- [X] T035 [P] [US3] Augment `backend/tests/test_posts.py` with `test_patch_post_rejects_published_or_failed_status` — both values rejected with 422 on `PATCH /api/v1/posts/{id}`.
- [X] T036 [P] [US3] Augment `backend/tests/test_posts.py` with `test_get_post_response_shape_includes_annotation_fields` — `GET /api/v1/posts/{id}` for a freshly seeded post returns `last_publish_attempt_at: null` and `last_publish_error: null` in the response body.

### Implementation for User Story 3

- [X] T037 [US3] In `backend/app/schemas/post.py`, add `PostStatusUserSettable = Literal["draft", "scheduled", "archived"]` and update the `status` field on both `PostCreate` and `PostUpdate` to use this Literal in place of the existing `PostStatus` enum reference. Leave `PostResponse.status` on the full enum (server still emits all 5 values).
- [X] T038 [P] [US3] In `frontend/src/components/PostForm.jsx`, change the `<select>` options for the status field to only render Draft / Scheduled / Archived. Remove the Published and Failed `<option>` elements (FR-016).
- [X] T039 [P] [US3] In `frontend/src/components/PostForm.jsx`, when `formData.status` is `'published'` or `'failed'`, replace the `<select>` with a read-only labeled chip (e.g., `<div>Status: Published</div>` styled like an existing read-only field). The status MUST remain visible — only its editability is removed (FR-017).
- [X] T040 [P] [US3] Create `frontend/src/components/PostForm.test.jsx` with at least four cases: (a) status dropdown for a draft post shows exactly 3 options; (b) form for a published post shows status as a read-only label, no `<select>`; (c) clicking Publish then Cancel on the modal does NOT call `postsApi.publish`; (d) clicking Publish then Confirm calls `postsApi.publish` exactly once and triggers the parent refresh callback.

**Checkpoint**: User Story 3 is functional. Quickstart §5 passes — dropdown options correct, API rejects `published`/`failed`, terminal status shown read-only.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation, regression checks, and submission-readiness.

- [X] T041 [P] Run `quickstart.md` end-to-end (sections 1-7) on a freshly built local stack. Document any deviations or environmental quirks at the bottom of `quickstart.md`.
- [X] T042 [P] Run `cd backend && pytest` and confirm zero failures, zero unexpected skips. The new `test_publisher.py` (T005-T013), `test_posts_publish_endpoint.py` (T019-T027), and the augmentations to `test_posts.py` (T032-T036) MUST all pass on green builds.
- [X] T043 [P] Run `cd frontend && npm test && npm run lint`. Vitest must show 27 + 4-or-more (the new `PostForm.test.jsx` cases) green; ESLint MUST report 0 errors and only the two pre-existing `AuthContext.jsx` warnings.
- [X] T044 [P] Verify the publisher emits structured log lines at expected levels: INFO on each successful publish, WARNING on in-tick retry, ERROR on retry-exhausted with the post id and error message. Use `pytest --log-cli-level=DEBUG` against `test_publisher.py` to spot-check.
- [X] T045 [P] Update the PR description for branch `006-auto-publish-flow` per Principle V (approach, assumptions, tradeoffs, what we'd improve with more time, Loom link). Specifically call out: (1) APScheduler was deliberately not used — stdlib polling is simpler and matches the freshness budget; (2) `failed` status is reserved for future external integration and is NEVER set by this PR; (3) the `005-auto-publish-scheduled` branch was the source of the publisher's structural skeleton.
- [X] T046 Confirm `frontend-integration-plan/REVIEW.md` Section 7 ("Honest gaps & violations") is updated — the bullet about "Status transitions are unguarded" can now be removed (or annotated as "fixed in 006") because this feature closes that gap.

**Checkpoint**: Feature is submission-ready. Run a final `git status` and ensure no working-tree changes outside of files this feature should touch.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS** all user stories. T002 → T003 are sequential (same `models/post.py`); T004 can run in parallel with the others (different file, additive only).
- **User Stories (Phase 3 / 4 / 5)**: All require Foundational complete.
  - **US2 implementation depends on US1's `_publish_one(...)` helper** (T028 reuses code authored in T014). US2's *tests* (T019-T027) can be written before T014 lands and will fail correctly until T014 + T028 land.
  - **US1 and US3 are independent** of each other — can be staffed in parallel.
- **Polish (Phase 6)**: Depends on US1, US2, US3 all green.

### User Story Dependencies

- **US1 (P1) — Auto-publish**: Foundational only. The MVP — could ship alone if scope shrinks.
- **US2 (P2) — Manual publish**: Foundational + reuses US1's `_publish_one` helper. Tests can be authored in parallel.
- **US3 (P3) — Status lockdown**: Foundational only. Independent.

### Parallel Execution Opportunities

**Within Phase 2 (Foundational)**: T004 [P] can run alongside T002/T003.

**Within Phase 3 (US1)**: After T014 + T015 (backend) lands, T016, T017, T018 (frontend) can all proceed in parallel — different files.

**Within Phase 4 (US2)**: All 9 tests (T019-T027) share one file and are sequential within that file. T028 (backend) and T029 (frontend api client) can run in parallel. T030 + T031 are in the same file (`PostForm.jsx`) and are sequential with each other and after T030 lands.

**Within Phase 5 (US3)**: T032-T036 are all augmentations to `test_posts.py` — sequential within that file. T037 is the schema change. T038-T040 are frontend in-parallel tasks across two files (`PostForm.jsx`, `PostForm.test.jsx`).

**Within Phase 6 (Polish)**: T041-T045 are all parallelizable.

### Suggested MVP Slice

**MVP = Phase 1 + Phase 2 + Phase 3 (US1 only)**. That delivers: auto-publish at scheduled time + catch-up on restart + sequential rule + cascade + failure annotation visible in UI. The dropdown lockdown (US3) and the manual-publish button (US2) are ship-after-MVP polish.

---

## Format Validation

Every task above follows the required format: `- [ ] T### [P?] [Story?] Description with file path`.

- ✓ Every task starts with the markdown checkbox `- [ ]`.
- ✓ Every task has a sequential ID `T001` … `T046`.
- ✓ User-story phase tasks all carry `[US1]` / `[US2]` / `[US3]`.
- ✓ Setup, Foundational, and Polish tasks have no story label.
- ✓ Every task names at least one file path or a verification step.
- ✓ `[P]` markers appear only on tasks that touch a different file from other in-phase tasks (no in-file collisions).

**Total tasks**: 46
**Per-story breakdown**: Setup 1, Foundational 3, US1 14, US2 13, US3 9, Polish 6.
**Test-first compliance**: All backend API endpoints touched (`POST /api/v1/posts/{id}/publish`, `POST /api/v1/posts` schema tightening, `PATCH /api/v1/posts/{id}` schema tightening, publisher core module) have their tests authored as the prior task in the same phase. Principle IX is satisfied.
