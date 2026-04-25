---
description: "Task list for the Content Management 003 upgrade"
---

# Tasks: Content Management (003 upgrade)

**Input**: Design documents from `specs/003-content-management/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/post-api.md`, `contracts/series-api.md`, `contracts/scheduling-invariant.md`, `high-level-design.md`, `quickstart.md`
**Constitution**: v1.2.0 (10 principles). **Enforced TDD for backend** per user's `/speckit-tasks` directive — every backend API task is preceded by a `[TF]` test-first task that MUST fail before its paired `[IMPL]` task runs. Principle IX's grandfather clause is NOT invoked.

**Organization**: grouped by user story. Two P1 stories (US1 create series, US2 15-min invariant) are the core; US3 + US4 (P1) and US5 (P2) round out the archival + post-editing story. Frontend port is its own phase bridging all stories.

## Format: `[ID] [P?] [Story] Description`

- `[P]` — can run in parallel (different files, no dependency on incomplete tasks).
- `[TF]` — test-first task (Principle IX). MUST produce a failing pytest run before the paired `[IMPL]` begins.
- `[IMPL]` — implementation task; MUST produce a passing pytest run.
- `[Story]` — US1..US5 tag for user-story phases only.
- File paths are absolute-from-repo-root.

## Test-First Discipline (Principle IX)

For every `[TF]` → `[IMPL]` pair:

1. Write/modify test code per the `[TF]` task.
2. Run `pytest <path>` and **observe failing** (commit the failing test or record "tests failing prior" in the next commit message).
3. Write implementation per the `[IMPL]` task.
4. Run `pytest <path>` and **observe passing**.
5. Commit.

Skipping the red-state observation is a Principle IX violation (NON-NEGOTIABLE).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: branch check + frontend dependency install (Tailwind + lucide).

- [X] T001 Confirm the working branch is `002-content-series` → rebase/merge onto `main` first if needed so `003-content-management` starts from a clean state with 001 + 002 work merged. Run `git branch --show-current` → expect `003-content-management`.

- [X] T002 In `frontend/`, install new dependencies per Principle II's justified deviation: `cd frontend && npm install --save lucide-react --save-dev tailwindcss postcss autoprefixer` (single invocation — npm 7+ supports mixed dep classes in one command and writes `package-lock.json` exactly once). Verify `frontend/package.json` gains exactly these 4 entries (lucide-react in `dependencies`; rest in `devDependencies`).

- [X] T003 Create `frontend/postcss.config.js` and `frontend/tailwind.config.js` wired for the Vite source scope (`./index.html`, `./src/**/*.{js,jsx}`). Tailwind theme extended with the CCM OKLCH palette + Inter / JetBrains Mono font stack (mirror `Creator-Content-Management/styles.css`). Append `@tailwind base; @tailwind components; @tailwind utilities;` directives to `frontend/src/index.css` (at the top of the file).

---

## Phase 2: Foundational (Schema + Migration)

**Purpose**: data-layer prerequisites for every API task. Models and migrations are NOT API code → Principle IX does not apply; Principle IV (pragmatic) governs. Test coverage follows transitively through the API-level tests.

**CRITICAL**: No user-story work can begin until Phase 2 is complete.

- [X] T004 [P] Edit `backend/app/models/post.py` to add 4 nullable columns: `body TEXT`, `published_url VARCHAR(1024)`, `stage VARCHAR(32)`, `previous_status VARCHAR(32)`. Keep existing columns and relationships untouched. See `data-model.md` §1.

- [X] T005 [P] Edit `backend/app/models/series.py` to add `status VARCHAR(32) NOT NULL DEFAULT 'active'` and `previous_status VARCHAR(32)` (nullable). Existing columns untouched.

- [X] T006 Edit `backend/app/core/database.py::init_db` idempotent ALTER block. Append guarded `ALTER TABLE posts ADD COLUMN ...` statements for `body`, `published_url`, `stage`, `previous_status`. Append guarded `ALTER TABLE series ADD COLUMN ...` for `status` (NOT NULL DEFAULT `'active'`) and `previous_status`. Each statement behind a `PRAGMA table_info`-based check so repeat boots no-op.

- [X] T007 [P] Edit `backend/app/schemas/post.py`: add `body: Optional[str] = Field(default=None, max_length=5000)` to `PostBase`. Extend `PostResponse` with optional read-only fields `stage`, `published_url`, `previous_status`. Add derived `author` field (string) that will be populated by the response factory (see T025).

- [X] T008 [P] Edit `backend/app/schemas/series.py` **additively only** (Phase 2 scope): (a) add `SeriesStagePayload` with `stage: Literal["Teaser","Announcement","Follow-up","Reminder"]`, `platform`, `title`, optional `body`, `scheduled_at`; (b) extend `SeriesSummary` / `SeriesResponse` with optional `status` and `previous_status`. **Do NOT touch the existing `SeriesCreate` (cadence-based) class** — that rewrite is paired with the handler rewrite in Phase 7 (T023) so T011's path-rebase green gate can observe existing series tests still passing against the unmodified create endpoint. See analysis finding F2.

- [X] T009 Delete the 6 legacy 002 frontend page files: `frontend/src/pages/PostsList.jsx`, `frontend/src/pages/PostEdit.jsx`, `frontend/src/pages/CalendarPage.jsx`, `frontend/src/pages/SeriesList.jsx`, `frontend/src/pages/SeriesEdit.jsx`, `frontend/src/pages/SeriesDetail.jsx`. Commit with message referencing Complexity Tracking deviation #4. `frontend/src/pages/Login.jsx` and `frontend/src/pages/Register.jsx` remain untouched.

**Checkpoint**: schema is in place locally. Verify with `docker compose up` then `sqlite3 backend/scheduler.db ".schema posts"` (external shell, not in the container) — look for the 4 new columns. `.schema series` should show the 2 new columns.

---

## Phase 3: API path rebase (TF-1, foundational backend) — BLOCKS EVERY OTHER BACKEND TASK

**Goal**: mount all three routers under `/api/v1` (plan Complexity Tracking deviation #2). Every existing 001 + 002 test currently hits `/api/...` paths. Re-route the prefix + rebase the paths in the tests in one TF cycle.

- [X] T010 [TF] **First**: run `ls backend/tests/` to confirm which test files currently exist (the 002 merge may have introduced additional files beyond the four assumed here, e.g., `test_series_v2.py` if a prior plan draft landed). Then in `backend/tests/test_auth.py`, `backend/tests/test_posts.py`, `backend/tests/test_scheduling.py`, `backend/tests/test_series.py`, and any other `test_*.py` files found: find-and-replace `"/api/` → `"/api/v1/` across every test. The existing ~54 tests should ALL fail after this edit because `main.py` still mounts at `/api`. Run `cd backend && pytest` and **observe ~54 failures** (connection OK, but endpoints return 404). Commit the failing tests.

- [X] T011 [IMPL] Edit `backend/app/main.py`: change `app.include_router(auth.router, prefix="/api")` → `prefix="/api/v1"`; same for `posts.router` and `series.router`. Also edit `frontend/src/api/client.js`: change `API_BASE` default from `"http://localhost:8000/api"` → `"http://localhost:8000/api/v1"`. Re-run `cd backend && pytest` → **observe all ~54 tests green** (the existing series-create test still sends the cadence-based body and still passes because T008 deferred the `SeriesCreate` rewrite to T023 — per analysis finding F2). Commit.

**Checkpoint**: path rebase complete. Every subsequent backend test writes `/api/v1/...` from the start.

---

## Phase 4: User Story 2 — 15-min invariant + sequential integrity (TF-2, backend)

**Goal**: `check_platform_gap` excludes archived posts (FR-018). New `check_sequential_integrity` pure function (FR-020). Both wired into the existing + new endpoints later.

**Independent Test**: seed an archived post on Instagram at `T`; attempt to create a new Instagram post at `T + 5min` — succeeds (archive-excluded). For Sequential Integrity: pass a non-increasing list of timestamps to `check_sequential_integrity` → returns a `SeqConflict`.

- [X] T012 [TF] [US2] In `backend/tests/test_scheduling.py` add: `test_returns_none_when_matching_post_is_archived` (seed a same-platform post with `status="archived"`; assert `check_platform_gap` returns `None`). Also add `test_check_sequential_integrity_strictly_increasing_returns_none`, `test_check_sequential_integrity_equal_adjacent_returns_conflict`, `test_check_sequential_integrity_returns_first_violation`, `test_check_sequential_integrity_empty_and_single_element_return_none`. Run `pytest backend/tests/test_scheduling.py` → **observe failures** (function doesn't exist; archive filter not yet added).

- [X] T013 [IMPL] [US2] In `backend/app/core/scheduling.py`: add `status != "archived"` to the WHERE clause in `check_platform_gap`. Add `SeqConflict` dataclass and `check_sequential_integrity(times: list[datetime]) -> Optional[SeqConflict]` pure function per `contracts/scheduling-invariant.md` §2. Re-run pytest → **green**.

**Checkpoint**: invariant primitives are ready for every endpoint that needs them.

---

## Phase 5: User Story 3a — Post archive lifecycle (TF-3, TF-4)

**Goal**: `POST /api/v1/posts/{id}/archive` + `POST /api/v1/posts/{id}/unarchive` endpoints. `DELETE /api/v1/posts/{id}` rejects published posts. `GET /api/v1/posts?include_archived=bool` query param.

**Independent Test**: Mark a post as `published`. DELETE returns 409 `published_requires_archive`. POST to `/archive` succeeds and flips status to `archived`. POST to `/unarchive` restores. `GET /api/v1/posts` (default) excludes it; `?include_archived=true` includes it.

- [X] T014 [TF] [US3] In `backend/tests/test_posts.py` add: `test_archive_post_happy_path` (200, status→archived, previous_status set), `test_unarchive_post_restores_previous_status`, `test_archive_already_archived_returns_409`, `test_unarchive_not_archived_returns_409`, `test_round_trip_archive_unarchive_is_lossless`, **`test_archive_post_404_for_other_owner`** and **`test_unarchive_post_404_for_other_owner`** (per FR-028 ownership scoping — analysis finding C1). Run pytest → **observe failures** (endpoints don't exist).

- [X] T015 [IMPL] [US3] In `backend/app/api/posts.py` add two handlers: `POST /{id}/archive` and `POST /{id}/unarchive` per `contracts/post-api.md`. Enforce owner scoping via existing `get_current_user_id`. Use the helper pattern from 002 for the 409 body shape. Re-run → **green**.

- [X] T016 [TF] [US3] In `backend/tests/test_posts.py` add: `test_delete_published_post_returns_409_published_requires_archive`, `test_delete_draft_scheduled_failed_post_returns_204`, `test_delete_archived_post_returns_204` (archived is already soft — hard delete allowed), `test_list_posts_excludes_archived_by_default`, `test_list_posts_with_include_archived_true_returns_archived`, **`test_delete_post_404_for_other_owner`** (C1). Run → **observe failures**.

- [X] T017 [IMPL] [US3] In `backend/app/api/posts.py::delete_post` add the `status == "published"` guard returning 409 `published_requires_archive`. In `list_posts` add an `include_archived: bool = False` query param; when `False`, add `Post.status != "archived"` to the WHERE clause. Re-run → **green**.

**Checkpoint**: Post-level archival fully shipped.

---

## Phase 6: User Story 3b — Series archive lifecycle (TF-5, TF-6)

**Goal**: `POST /api/v1/series/{id}/archive` cascades to all child posts. `POST /api/v1/series/{id}/unarchive` restores the series + every post whose `previous_status` is set. `DELETE /api/v1/series/{id}` rejects when ≥1 child post is `published` (FR-016). `GET /api/v1/series?include_archived=bool`.

**Independent Test**: create a series, mark one of its 4 posts as `published`. DELETE returns 409 `series_has_published_posts`. Archive the series — series + all 4 posts become `archived` with `previous_status` set. Unarchive restores cleanly. Default list excludes the archived series.

- [X] T018 [TF] [US3] In `backend/tests/test_series.py` add: `test_archive_series_cascades_to_all_posts`, `test_unarchive_series_restores_all_posts_previous_status`, `test_archive_already_archived_series_returns_409`, `test_unarchive_not_archived_series_returns_409`, `test_archive_unarchive_series_round_trip_lossless`, **`test_archive_series_404_for_other_owner`** and **`test_unarchive_series_404_for_other_owner`** (C1). Run → **observe failures**.

- [X] T019 [IMPL] [US3] In `backend/app/api/series.py` add `POST /{id}/archive` and `POST /{id}/unarchive` handlers per `contracts/series-api.md`. Implement the cascade per `data-model.md` §6. Re-run → **green**.

- [X] T020 [TF] [US3] In `backend/tests/test_series.py` add: `test_delete_series_with_published_post_returns_409_series_has_published_posts`, `test_delete_pre_execution_series_returns_204` (no post is `published` → hard cascade delete), `test_list_series_excludes_archived_by_default`, `test_list_series_with_include_archived_true`, **`test_delete_series_404_for_other_owner`** (C1). Run → **observe failures**.

- [X] T021 [IMPL] [US3] In `backend/app/api/series.py::delete_series` add the `any(p.status == "published" for p in series.posts)` guard returning 409 `series_has_published_posts`. In `list_series` add the `include_archived: bool = False` query param. Re-run → **green**.

**Checkpoint**: Series-level archival fully shipped.

---

## Phase 7: User Story 1 — templated series-create (TF-7)

**Goal**: `POST /api/v1/series` accepts the new 4-stage body (replacing the 002 cadence body — plan Complexity Tracking deviation #3). Validates Pydantic literal stage order → runs `check_sequential_integrity` → runs `check_platform_gap` per stage → runs pairwise 15-min check across sibling stages → atomic insert.

**Independent Test**: submit a well-formed 4-stage body → 201 with 4 posts in the response. Submit with Teaser.scheduled_at > Announcement.scheduled_at → 409 `sequential_integrity_violation`. Submit with two same-platform stages 5 min apart → 409 `platform_gap_conflict` with `series_post_index`. Submit with multi-platform stages (IG + Twitter + LinkedIn + Instagram) → 201 (FR-005 supersedence).

- [X] T022 [TF] [US1] In `backend/tests/test_series.py` REPLACE the existing `test_create_series_happy_path` with the new 4-stage body (per `contracts/series-api.md`); rename to `test_create_series_4_stage_happy_path`. ADD: `test_create_series_wrong_stage_order_returns_422`, `test_create_series_sequential_integrity_violation_returns_409`, `test_create_series_stage_15min_collision_existing_post_returns_409_with_series_post_index`, `test_create_series_stage_15min_collision_between_siblings_returns_409`, `test_create_series_multi_platform_allowed` (stages span IG + Twitter + LinkedIn + Instagram → 201), `test_create_series_atomic_abort_on_conflict_zero_writes`. Remove or rewrite any 002 test asserting single-platform-per-series (FR-005 superseded). Run → **observe failures**.

- [X] T023 [IMPL] [US1] In `backend/app/schemas/series.py`: REPLACE the cadence-based `SeriesCreate` class with the new 4-stage shape — `name` (required), optional `description`, `stages: list[SeriesStagePayload] = Field(min_length=4, max_length=4)`. (This is the schema rewrite F2 moved out of T008 into this same cycle.) THEN in `backend/app/api/series.py`, REWRITE `create_series` to consume the new `SeriesCreate`. Validate stage ordering in the handler (Pydantic already checks the `Literal`; add position-vs-label check). Call `check_sequential_integrity(times)` → first fail raises 409. For each stage call `check_platform_gap(...)` → first collision raises 409 with `series_post_index`. Run pairwise same-platform check across stages. Atomic write: 1 `Series` row + 4 `Post` rows with `stage`, `series_position`, `body`, `status="scheduled"`, `owner_id`. Re-run pytest → **green**.

**Checkpoint**: US1 fully functional end-to-end at the API layer.

---

## Phase 8: User Story 4 — Post content edits (TF-8, TF-9)

**Goal**: `PostCreate` / `PostUpdate` accept `body`. `PostResponse` exposes derived `author`. `PATCH /api/v1/posts/{id}` allows platform changes on series posts (FR-005b superseded) and re-checks Sequential Integrity when `scheduled_at` moves on a series post.

**Independent Test**: POST a new post with `{body: "..."}` and verify it round-trips. PATCH an existing series post's platform → 200 (not 400). PATCH a series post's `scheduled_at` into a value that makes it earlier than its predecessor → 409 `sequential_integrity_violation`.

- [X] T024 [TF] [US4] In `backend/tests/test_posts.py` add: `test_create_post_with_body_round_trips`, `test_patch_post_body_persists`, `test_post_response_includes_derived_author_from_owner_full_name`, `test_post_response_falls_back_to_owner_email_when_full_name_is_null`. Run → **observe failures** (body not accepted; author not in response).

- [X] T025 [IMPL] [US4] Wire `body` through in `backend/app/api/posts.py::create_post` and `update_post` (already covered by Pydantic model expansion in T007 — just verify the attribute is written to the ORM). Add author derivation using EITHER (a) a Pydantic v2 `model_validator(mode="before")` on `PostResponse` that reads the related `owner` attribute, OR (b) a small response-serialization helper called from each handler. Implementer's choice — both are idiomatic; pick whichever reads cleaner against the test assertions in T024. Re-run → **green**.

- [X] T026 [TF] [US4] In `backend/tests/test_posts.py` REWRITE `test_patch_rejects_platform_change_on_series_post` to `test_patch_allows_platform_change_on_series_post` — same setup, but now assert 200 and that the 15-min check re-ran against the new platform. ADD: `test_patch_series_post_scheduled_at_breaks_sequential_integrity_returns_409`, `test_patch_series_post_scheduled_at_preserves_sequential_integrity_returns_200`, `test_patch_series_post_body_does_not_trigger_scheduling_recheck`. Run → **observe failures** (002 guard still rejects 400; sequential-integrity re-check not present).

- [X] T027 [IMPL] [US4] In `backend/app/api/posts.py::update_post`: REMOVE the FR-005b branch that rejected platform change when `post.series_id IS NOT NULL`. ADD: when `scheduled_at` is in the patch AND the post has a `series_id`, load all sibling series posts ordered by `series_position`, substitute the new `scheduled_at` at this post's index, and call `check_sequential_integrity(new_times)`. On non-None → raise 409 `sequential_integrity_violation` per `contracts/scheduling-invariant.md`. Re-run → **green**.

**Checkpoint**: all backend work for this 003 upgrade is complete. Full backend pytest suite should be green (original 14 + all TF additions — approximately 70–80 tests).

---

## Phase 9: Frontend port (Principle IV pragmatic; no TDD required)

**Goal**: port the CCM reference implementation into `frontend/src/` as Vite-native React. Components sit directly under `frontend/src/components/`; single new `Dashboard.jsx` replaces the 6 deleted 002 pages.

**Principle VII** applies throughout: loading states, error toasts surfacing `detail.message` verbatim, empty states, destructive-action confirmation, nav link coverage.

- [X] T028 [P] Create `frontend/src/components/Primitives.jsx` — port from `/Users/yuxuanhu/Desktop/takehome/Creator-Content-Management/primitives.jsx`. Replace the CDN-style `const { useState } = React;` destructuring with `import` statements. Replace `Object.assign(window, {...})` exports with `export { ... }`. Keep class names verbatim (Tailwind).

- [X] T029 [P] Create `frontend/src/components/Icon.jsx` — thin wrapper over `lucide-react` that preserves CCM's `<Icon name="sparkles" size={14} />` prop surface. Map the icon names used across CCM (sparkles, megaphone, message-square, bell, lock, git-branch, x, info, alert-triangle, ban, check, archive, trash-2, chevron-right, search, calendar, list, plus, external-link) to their `lucide-react` component exports in a single object.

- [X] T030 [P] Create `frontend/src/components/Toast.jsx` — lift the inline toast JSX from CCM's `app.jsx` into a stand-alone component. Single prop: `{ kind: "success" | "error", message: string, onClose: () => void }`.

- [X] T031 [P] Create `frontend/src/components/ConfirmModal.jsx` — port from `/Users/yuxuanhu/Desktop/takehome/Creator-Content-Management/confirm-modal.jsx`.

- [X] T032 [P] Create `frontend/src/components/utils.js` — port `findConflicts` and the date helpers. Import `date-fns` functions via ES imports (`import { parseISO, differenceInMinutes } from "date-fns"`) rather than CCM's UMD `df.*`. Mirror the backend's invariant semantics (same-owner + same-platform + non-archived + strict boundary).

- [X] T033 [P] Create `frontend/src/components/PostForm.jsx` — port from CCM's `post-form.jsx`. Accepts `body` field. On save, calls the appropriate `postsApi.create` / `postsApi.update`. On 409 from the server, surfaces `err.message` verbatim in the inline error box (no generic-copy substitution — Principle VII / FR-018a). **Principle VII self-check**: (a) Saving button shows pending state during the fetch. (b) Server errors render `err.message` verbatim. (c) Form inputs have placeholders / helper text (no fully-blank state). (d) Cancel is a named "Cancel" button, not a destructive action.

- [X] T034 [P] Create `frontend/src/components/SeriesBuilder.jsx` — port from CCM's `series-builder.jsx`. Locked 4-stage template (Teaser → Announcement → Follow-up → Reminder) with stage labels read-only. Date + time inputs NOT pre-populated. 15-minute rule banner pinned at the top. Client-side `check_sequential_integrity` mirror (from `utils.js`) plus the existing 15-minute conflict check — both run before enabling the submit button. On submit: `seriesApi.create({ name, description, stages: [...] })` matching the new backend body shape. **Principle VII self-check**: (a) Submit button disabled until all 4 stages pass validation; shows "Creating…" during the fetch. (b) 409 `series_post_index` highlights the offending stage block and surfaces the server message verbatim. (c) Open modal with no stages filled → empty state of each stage block shows the hint text from the CCM template. (d) Cancel triggers a confirm-modal only if any field is non-empty ("Discard unsaved changes?").

- [X] T035 [P] Create `frontend/src/components/ListView.jsx` — port from CCM's `list-view.jsx`. Calls `postsApi.list({ include_archived: true })` + `seriesApi.list({ include_archived: true })` so archived items render with the faded "archived" styling. Exposes "Unarchive" action on archived rows (calls `postsApi.unarchive(id)` or `seriesApi.unarchive(id)`). Exposes "Archive" action on published rows instead of Delete (FR-014). **Principle VII self-check**: (a) Skeleton / "Loading your schedule…" message during the initial fetch. (b) 4xx from unarchive/archive surfaces the server message verbatim in a toast. (c) Zero-rows state shows the CCM empty-state copy with a "Create a post" / "Create a series" CTA. (d) Delete / Archive actions each open `ConfirmModal` — single-click never fires destructive work.

- [X] T036 [P] Create `frontend/src/components/CalendarView.jsx` — port from CCM's `calendar-view.jsx`. Calls list endpoints WITHOUT `include_archived=true` (omit param → backend default false → archived hidden). Wraps the existing `react-big-calendar` instance with the new Tailwind styling. **Principle VII self-check**: (a) Loading state during fetch. (b) If fetch fails, surface the server error verbatim in a toast and render an empty grid (not a crash). (c) Empty calendar shows a muted "No scheduled posts in this month" message rather than blank whitespace. (d) Click on an event opens `PostForm` (non-destructive); delete happens only from the form's dedicated Delete button with `ConfirmModal`.

- [X] T037 Rewrite `frontend/src/components/Layout.jsx` — inline CCM's `TopNav` + `SubHeader` patterns. Nav links: Dashboard (`/`), Log out. Single auth-gated shell wrapping `<Outlet />`. Remove the 002 nav entries (Posts, Series, Calendar, New Post) since Dashboard now houses all of them.

- [X] T038 Create `frontend/src/pages/Dashboard.jsx` — top-level page wiring `TopNav` + `SubHeader` + view-switch between `ListView` and `CalendarView` + modal overlays for `PostForm`, `SeriesBuilder`, `ConfirmModal`, `Toast`. Port the state management from CCM's `app.jsx`. Fetch from `postsApi` + `seriesApi` on mount; re-fetch after any mutation. **Principle VII self-check**: (a) Initial page load shows the `LoadingView`/spinner until both `postsApi.list()` and `seriesApi.list()` resolve. (b) Any mutation that raises an error bubbles the `err.message` to `Toast` verbatim (no generic-copy substitution). (c) When both lists are empty the Dashboard shows a friendly onboarding CTA ("Create your first post or series"). (d) All destructive actions (post delete, series delete, post archive, series archive) route through `ConfirmModal`.

- [X] T039 Update `frontend/src/App.jsx` — simplify routes to: `/login` → `Login`, `/register` → `Register`, `/` (within `ProtectedRoute` + `Layout`) → `Dashboard`. Remove imports of the deleted 002 pages. Catch-all redirect to `/`.

- [X] T040 Update `frontend/src/api/client.js` — already path-rebased in T011. ADD: `seriesApi.create(data)` now sends the 4-stage body shape (already implied by the existing `create` method; confirm the POST body matches). ADD: `postsApi.archive(id)`, `postsApi.unarchive(id)`, `seriesApi.archive(id)`, `seriesApi.unarchive(id)`. Extend `postsApi.list(params)` and `seriesApi.list(params)` to accept an `include_archived` boolean and serialize it into the query string.

- [X] T041 [P] Update `frontend/src/api/client.test.js` — ADD Vitest cases for `postsApi.archive/unarchive`, `seriesApi.archive/unarchive`, and the new `include_archived` query parameter (mocked fetch). Principle IV pragmatic; skip if timeboxed. Existing 22 Vitest tests MUST remain green.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T042 Update `backend/scripts/seed_data.py`: 4-stage templated series — one "Spring Launch" series per seeded user (stages spanning 2+ platforms to exercise the FR-005 supersedence) + one example archived post per user. Use positional timestamps at least 15 min apart. Idempotent (skip if `alice@example.com` already exists — existing 002 pattern).

- [X] T043 Update `readme.md`: add a short "Content Management (003 upgrade)" section noting (a) the `/api/v1` path change, (b) the new frontend deps (Tailwind + lucide-react), (c) the new Dashboard UI, (d) the archival lifecycle. Link to `specs/003-content-management/quickstart.md` for the demo walk-through.

- [X] T044 Run the full backend suite: `docker run --rm -v $(pwd)/backend:/app -w /app python:3.11-slim sh -c "pip install -q -r requirements.txt && pytest"`. Confirm all tests green (expect ~70–80 total: 54 from 001/002 + ~20–25 new in this PR).

- [X] T045 Run frontend: `cd frontend && npm ci && npm run lint && npm run test && npm run build`. ESLint should exit 0 (the 2 legacy warn-level rules from 001 remain warn-level). Vitest should pass (22 existing + any new from T041). Vite build should succeed — this catches bad imports, unused exports, Tailwind misconfigurations.

- [ ] T046 Run `docker compose build` on the feature branch; then `docker compose up` + manual UI smoke itemized against Principle VII's four mandates:
    - [ ] **(a) Loading state**: log in → observe spinner / skeleton / disabled button while Dashboard fetches from `/api/v1/posts` and `/api/v1/series`; data appears.
    - [ ] **(b) Error surfacing verbatim**: attempt a same-platform post 5 min from an existing one → observe the toast text is exactly the server's `detail.message` string, NOT a generic "Something went wrong".
    - [ ] **(c) Empty state**: register a fresh user; navigate to Dashboard → observe the empty-state copy naming the action to take (e.g., "No series yet — create one to plan a campaign").
    - [ ] **(d) Destructive-action confirmation**: attempt to delete (hard) a post OR archive a published post → confirm-modal appears; canceling keeps the item intact; confirming takes the action.
  Record pass/fail per sub-item in the PR description.

- [ ] T047 Draft the PR description per Constitution Principle V. Required sections: **approach**, **assumptions** (verbatim from spec Assumptions block), **tradeoffs** (enumerate all six deviations from plan Complexity Tracking + the two 002 clause supersedences), **what I'd improve with more time** (real background publisher, `author` as multi-user / teams, monthly cadences, ruleset-as-code for branch protection, Alembic migration path), **Loom link** placeholder. Include explicit Principle IX compliance report: list every `[TF]` / `[IMPL]` pair and link to the git commits showing red→green for each.

- [ ] T048 Record the Loom (5–10 min): (a) the `/api/v1` version bump visible in Swagger; (b) create a 4-stage series, trigger a Sequential Integrity 409 and a 15-min 409 to show error surfacing; (c) archive round-trip (post + series); (d) walk through `scheduling.py`'s new `check_sequential_integrity` and one TF commit pair; (e) the six documented deviations with one-sentence justifications. Paste link into T047's PR description.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; blocks every other backend + frontend phase.
- **API path rebase (Phase 3)**: depends on Foundational; BLOCKS every other backend phase because every `[TF]` task writes `/api/v1/...` paths that would 404 before T011 lands.
- **US2 (Phase 4 — invariant + sequential integrity)**: depends on Phase 3; blocks US1 and US4 (which both call the new primitives).
- **US3a (Phase 5 — post archive)**: depends on Phase 4 (indirectly via scheduling primitives; directly only on Phase 3 + T007 schema).
- **US3b (Phase 6 — series archive)**: depends on Phase 5 indirectly (shared patterns) and directly on Phase 3 + T008 schema.
- **US1 (Phase 7 — templated series-create)**: depends on Phase 4 (needs `check_sequential_integrity`) + Phase 6 (shares `SeriesResponse` shape). Also depends on T008 schema.
- **US4 (Phase 8 — post content edits)**: depends on Phase 4 (sequential-integrity re-check) + Phase 7 (since it exercises series posts created by the templated flow).
- **Frontend port (Phase 9)**: depends on Phase 2 (T009 for the deletions) + Phase 3 (for the `/api/v1` base URL). Individual component tasks within Phase 9 are mostly parallel.
- **Polish (Phase 10)**: depends on everything else complete.

### Within each user story

- `[TF]` → run pytest → observe red → `[IMPL]` → run pytest → observe green → commit. Strict ordering.
- Implementations that touch shared modules (like `scheduling.py`) must be sequential across TF cycles.

### Parallel opportunities

- Phase 2: T004 + T005 + T007 + T008 + T009 are all independent-file edits → mark `[P]`.
- Phase 9: T028, T029, T030, T031, T032, T033, T034, T035, T036 are all independent new-file creations → `[P]`.
- Phase 10: T044 + T045 can run in parallel (different commands, different processes).

---

## Parallel Example: Phase 2 Foundational

```bash
# All different files — launch in parallel:
Task: "Edit backend/app/models/post.py"                # T004
Task: "Edit backend/app/models/series.py"              # T005
Task: "Edit backend/app/schemas/post.py"               # T007
Task: "Edit backend/app/schemas/series.py"             # T008
Task: "Delete 6 legacy frontend pages"                 # T009

# After those, sequential:
Task: "Update backend/app/core/database.py init_db"    # T006
```

## Parallel Example: Phase 9 Frontend components

```bash
# All new files, independent — launch in parallel:
Task: "Primitives.jsx"         # T028
Task: "Icon.jsx"               # T029
Task: "Toast.jsx"              # T030
Task: "ConfirmModal.jsx"       # T031
Task: "utils.js"               # T032
Task: "PostForm.jsx"           # T033
Task: "SeriesBuilder.jsx"      # T034
Task: "ListView.jsx"           # T035
Task: "CalendarView.jsx"       # T036

# Then sequential:
Task: "Rewrite Layout.jsx"     # T037 (depends on primitives + icon)
Task: "Create Dashboard.jsx"   # T038 (depends on all the above)
Task: "Update App.jsx"         # T039
Task: "Update client.js"       # T040
```

---

## Implementation Strategy

### MVP First (US1 + US2 + path rebase)

Ship the minimum that closes the assignment's hard constraint AND the user's core UX directive:

1. Phase 1 + Phase 2 (setup + schema).
2. Phase 3 (path rebase — required by everything).
3. Phase 4 (US2 invariant + sequential integrity).
4. Phase 7 (US1 templated series-create).
5. Stop, manually verify: `POST /api/v1/series` with a 4-stage body works end-to-end.
6. If timebox allows: Phase 5 + 6 (archival) → Phase 8 (post edits) → Phase 9 (UI).
7. Phase 10 is the last 30-min polish window before PR.

### Cutting order under time pressure

If the clock is running out, cut in this order:

1. **Cut T048 (Loom)** — record after the PR opens.
2. **Cut T041 (Vitest for new client methods)** — Principle IV pragmatic.
3. **Cut T042 (seed enrichment)** — existing 002 seed already populates the app.
4. **Cut Phase 9 partial** — ship the backend complete; frontend stub shows "Coming soon". NOT recommended; reviewers won't see the new UX.
5. **DO NOT cut Phase 3 (path rebase)** — every other backend task writes `/api/v1/...`.
6. **DO NOT cut any `[TF]` task** — Principle IX NON-NEGOTIABLE; user's `/speckit-tasks` input explicitly reinforces "enforced TDD for backend".
7. **DO NOT cut T044 (pytest green gate)** — CI will catch it anyway.

---

## Done criteria

- Every `[TF]` task demonstrably ran red before its paired `[IMPL]`; every `[IMPL]` produced green. Visible in the git commit log.
- `cd backend && pytest` is green (70–80 tests).
- `cd frontend && npm run test && npm run lint && npm run build` is green.
- `docker compose build` is green.
- Manual UI smoke per T046 passed all four Principle VII checkpoints.
- PR description contains the five elements from Principle V + the Principle IX compliance report.
- CI (the four jobs from 001) green on the PR.

---

## Notes

- "Enforced TDD for backend" (user's `/speckit-tasks` directive) reinforces Constitution Principle IX. Every backend API or correctness-core task has an explicit `[TF]` → `[IMPL]` pair in this list. No grandfather clause.
- `[P]` only on tasks that touch different files and have no dependency on incomplete tasks. Inside a `[TF]`/`[IMPL]` cycle, the two are strictly sequential by definition.
- No edits permitted to `backend/app/api/auth.py`, `backend/app/core/security.py`, `frontend/src/pages/Login.jsx`, `frontend/src/pages/Register.jsx`, `frontend/src/components/ProtectedRoute.jsx` (all 001/002 concerns outside the 003 upgrade's scope).
- The six pre-existing 002 page components ARE edited (deleted — T009); this is the Principle I deviation #4 documented in `plan.md` Complexity Tracking.
- Commit after each task or each `[TF]` / `[IMPL]` pair so CI + reviewers can observe the failing→passing transition.
