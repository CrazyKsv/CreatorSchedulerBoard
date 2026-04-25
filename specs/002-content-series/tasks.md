---
description: "Task list for the Content Series feature (002-content-series)"
---

# Tasks: Content Series

**Input**: Design documents from `specs/002-content-series/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/series-api.md`, `contracts/scheduling-invariant.md`, `high-level-design.md`, `quickstart.md`
**Constitution**: v1.2.0 (10 principles). This task list **adopts Principle IX** (Test-First for Backend API, NON-NEGOTIABLE) per `Tasks-Q1` answer in `questions/002-content-series-pre-spec-answers.md`. Every backend API task is preceded by a test task that MUST fail before the implementation lands.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently. Both P1 stories (US1 series creation, US2 invariant enforcement) ship in the same PR; US3 (P2 browse/manage) ships alongside them but the cut-order section explains how to drop it under time pressure. The execution order interleaves stories at the implementation level because US1 depends on US2's invariant being in place.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: Maps to `spec.md` user stories (US1 = create series; US2 = enforce invariant; US3 = browse/manage).
- File paths are absolute-from-repo-root.

## Path Conventions

- **Web application** matching the repo: `backend/`, `frontend/`, plus the `specs/`, `plan/`, and `questions/` documentation surfaces.

## Test-First Discipline (Principle IX)

For tasks marked with `[TF]`:

1. Write the test code in the named test file.
2. Run `pytest <path>` (or the relevant subset) and **observe a failing run**.
3. Commit the failing test (or note in the next implementation commit message that the test was failing prior).
4. Write the implementation in the named source file.
5. Re-run `pytest <path>` and **observe a passing run**.
6. Commit the implementation.

Every `[TF]` test task MUST be authored before its paired `[IMPL]` task starts. Skipping the failing-state observation is a Principle IX violation.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: confirm working environment for the feature branch.

- [X] T001 Confirm the working branch is `002-content-series` (`git branch --show-current`) and the working tree is clean (`git status` shows only the in-flight `specs/`, `plan/`, `questions/`, and `CLAUDE.md` artifacts already created during planning). If anything else is dirty, halt and ask the user before proceeding.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: data layer needed by every API task. These are NOT API code so Principle IX does not apply; Principle IV (pragmatic) governs. Tests for the new ORM relationships are exercised transitively by `test_series.py` later.

**CRITICAL**: No US-phase work can begin until Phase 2 is complete.

- [X] T002 [P] Create `backend/app/models/series.py` defining `Series` per `data-model.md` §1: columns `id`, `title`, `description`, `platform`, `start_at`, `cadence_unit`, `cadence_interval`, `post_count`, `owner_id` (FK `users.id`), `created_at`, `updated_at`. SQLAlchemy declarative; `tablename = "series"`. Add the `owner` relationship and the `posts` relationship (`back_populates="series"`, `cascade="all, delete-orphan"`, `order_by="Post.series_position"`).

- [X] T003 [P] Edit `backend/app/models/post.py` to add two nullable columns: `series_id = Column(Integer, ForeignKey("series.id"), nullable=True)` and `series_position = Column(Integer, nullable=True)`. Add the `series = relationship("Series", back_populates="posts")` line. Do NOT touch any existing column.

- [X] T004 [P] Edit `backend/app/models/user.py` to add `series = relationship("Series", back_populates="owner", cascade="all, delete-orphan")` next to the existing `posts` relationship.

- [X] T005 Edit `backend/app/core/database.py`. After `Base.metadata.create_all` in `init_db()`, append the idempotent ALTER block from `data-model.md` §4 — probe `PRAGMA table_info(posts)` and `ALTER TABLE posts ADD COLUMN ...` for each missing column (`series_id INTEGER REFERENCES series(id)`, `series_position INTEGER`). Wrap in `await conn.run_sync(_probe_and_alter)`. Idempotent on repeat runs.

- [X] T006 [P] Create `backend/app/schemas/series.py` per `data-model.md` §5: `Platform` and `CadenceUnit` `Literal` types, `SeriesBase`, `SeriesCreate`, `SeriesUpdate` (only `title` and `description`), `SeriesSummary` (no embedded posts), `SeriesResponse` (extends Summary, embeds `list[PostResponse]`). Use `Field(ge=..., le=...)` for numeric bounds, `min_length=1` for required strings.

- [X] T007 Edit `backend/app/schemas/post.py`. Add two read-only optional fields to `PostResponse`: `series_id: Optional[int] = None`, `series_position: Optional[int] = None`. Do NOT add them to `PostCreate` or `PostUpdate` (FR-005a). `Config.from_attributes = True` already present.

**Checkpoint**: schema is in place. `docker compose down && docker compose up` (or just restart backend) brings the new `series` table online and adds the two new `posts` columns. Verify with `sqlite3 backend/scheduler.db ".schema posts"` and `".schema series"`.

---

## Phase 3: User Story 2 - Enforce 15-min invariant on ALL post writes (Priority: P1)

**Goal**: every code path that writes `Post.scheduled_at` rejects within-window same-platform conflicts with a 409 in the FR-011 shape. This unblocks US1 (series-create needs the invariant) and is the constitution's NON-NEGOTIABLE Principle III.

**Independent Test**: `POST /api/posts` twice on the same platform 10 min apart → second is 409. Twice exactly 15 min apart → both 201. Twice on different platforms same time → both 201. PATCH a post to its own current time → 200.

### Test-First — `check_platform_gap`

- [X] T008 [TF] [US2] Create `backend/tests/test_scheduling.py` with the focused unit tests from `data-model.md` §9 + `contracts/scheduling-invariant.md`: `test_returns_none_when_scheduled_at_is_null`, `test_returns_none_when_no_other_post`, `test_returns_conflict_within_window`, `test_returns_none_at_exact_15_minute_boundary`, `test_returns_none_for_different_platform`, `test_returns_none_for_different_owner`, `test_excludes_post_id_when_provided`, `test_includes_posts_of_any_status`. Use the existing `auth_headers` / `client` fixtures and a helper that inserts `Post` rows directly via the session for the comparison subjects. Run `cd backend && pytest tests/test_scheduling.py` and **observe ImportError / failures**. Commit the failing test file.

- [X] T009 [IMPL] [US2] Create `backend/app/core/scheduling.py` exactly as `data-model.md` §7 + `contracts/scheduling-invariant.md` specify. Module constant `GAP = timedelta(minutes=15)`. `Conflict` dataclass with `other_post_id`, `other_scheduled_at`, `delta_minutes`, and a `human_message` property. Async `check_platform_gap(db, *, owner_id, platform, scheduled_at, exclude_post_id=None)` returning `Optional[Conflict]`. Strict `>` and `<` boundary. Re-run `pytest tests/test_scheduling.py` and **observe all green**.

### Test-First — `posts.py` invariant wiring

- [X] T010 [TF] [US2] Edit `backend/tests/test_posts.py` to add the invariant cases for the existing `/api/posts` endpoint: `test_create_rejects_within_15_min_same_platform`, `test_create_accepts_exactly_15_min_same_platform`, `test_create_accepts_same_time_different_platform`, `test_patch_self_does_not_conflict`, `test_patch_into_conflict_rejected`. Each test asserts the 409 response body matches FR-011's shape (`detail.error == "platform_gap_conflict"`, `conflict_with_post_id`, `conflict_with_scheduled_at`, `delta_minutes`). Run `cd backend && pytest tests/test_posts.py` and **observe the new cases failing** while existing ones still pass.

- [X] T011 [IMPL] [US2] Edit `backend/app/api/posts.py`. In `create_post`: before `db.add(post)`, call `await check_platform_gap(db, owner_id=user_id, platform=data.platform, scheduled_at=data.scheduled_at)`; if non-None, raise `HTTPException(409, detail={"error": "platform_gap_conflict", "message": conflict.human_message, "conflict_with_post_id": conflict.other_post_id, "conflict_with_scheduled_at": conflict.other_scheduled_at.isoformat(), "delta_minutes": conflict.delta_minutes})`. In `update_post`: after loading the existing `post`, if `data.scheduled_at` or `data.platform` is in the update payload, compute the effective `(platform, scheduled_at)` pair and call `check_platform_gap` with `exclude_post_id=post.id`. Re-run `pytest tests/test_posts.py` and **observe all green**.

### Test-First — FR-005a (PATCH cannot mutate series fields) and FR-005b (PATCH cannot change platform on series posts)

- [X] T012 [TF] [US2] Add to `backend/tests/test_posts.py`: `test_patch_does_not_mutate_series_id` (PATCH a series post with `series_id=null` in body → 200, but `GET` afterwards still shows the original `series_id`); `test_patch_does_not_mutate_series_position` (similar); `test_patch_rejects_platform_change_on_series_post` (4xx with descriptive message); `test_patch_allows_platform_change_on_standalone_post` (200). The first two should pass automatically once `PostUpdate` excludes those fields (FR-005a was already designed this way); the third needs a guard. Run pytest, **observe the third test failing** and the others passing or failing as predicted.

- [X] T013 [IMPL] [US2] In `backend/app/api/posts.py` `update_post`: before applying the patch dict, if `"platform"` is in the unset-excluded payload AND the loaded post has a non-null `series_id`, raise `HTTPException(400, detail={"error": "series_post_platform_immutable", "message": "Series posts inherit the series' platform; re-planning requires deleting the series and creating a new one."})`. Status code is deliberately **400** (validation rule), not 409 — 409 is reserved for `platform_gap_conflict` so the frontend handler can switch on `detail.error` unambiguously (see analysis I7). Re-run pytest; **observe all green**.

**Checkpoint**: US2 fully shipped. `pytest tests/test_scheduling.py tests/test_posts.py` is green. The 15-minute invariant is now enforced across both `POST` and `PATCH /api/posts`. Commit.

---

## Phase 4: User Story 1 — Create scheduled content series (backend) (Priority: P1)

**Goal**: `POST /api/series` materializes 1–20 posts atomically, calling the invariant on each generated timestamp, returning the FR-011 409 on first conflict (with `series_post_index` for series context).

**Independent Test**: `POST /api/series` with a valid 4-post weekly Instagram series → 201 with `posts` array of length 4 in `series_position` order. Pre-seed a conflicting Instagram post 5 minutes before `start_at` → second `POST /api/series` returns 409, `SELECT count(*) FROM posts` unchanged, `SELECT count(*) FROM series` unchanged.

### Test-First — series creation endpoint

- [X] T014 [TF] [US1] Create `backend/tests/test_series.py` with the create-series tests from `data-model.md` §9: `test_create_series_happy_path` (201, response includes 4 posts ordered by `series_position`, each tagged with `series_id` and correct `series_position`, titles are `"…— part 1"` through `"…— part 4"` per FR-002a, `status="scheduled"`); `test_create_series_blocks_on_existing_post_conflict` (pre-seed conflicting post, attempt series-create, assert 409 with FR-011 shape AND `detail.series_post_index == 0`, then assert `len(posts) == 1` (just the seed) and `len(series) == 0` via direct SQL); `test_create_series_with_past_start_at_succeeds` (FR-001 amendment per Clarify-Q6); `test_create_series_with_post_count_zero_rejected_by_pydantic_422` and `test_create_series_with_post_count_21_rejected_by_pydantic_422`; `test_create_series_requires_auth` (401 without bearer). Run `cd backend && pytest tests/test_series.py` and **observe all failing** (endpoint doesn't exist).

- [X] T015 [IMPL] [US1] Create `backend/app/api/series.py`. Router `prefix="/series"`, `tags=["series"]`. Implement `POST /` per `contracts/series-api.md` and `data-model.md` §8 bulk path: validate Pydantic; compute N times via the shared `generate_schedule` helper; pairwise sibling precheck on the N times (raise 409 with `series_post_index=j` if any pair within 15 min); per-time `check_platform_gap` call (raise 409 with `series_post_index=i` on first conflict); on success, open a transaction, insert `Series`, `await db.flush()` for the id, then insert N `Post` rows with auto-titles `"{series.title} — part {i+1}"` and `status="scheduled"`. Helper `_conflict_409(...)` factory shared with the single-post path so the response body shape is identical (Principle X). Re-run `pytest tests/test_series.py` — observe the create-series tests **passing**; the GET/PATCH/DELETE tests in T020 will still fail (endpoint doesn't exist yet, but those test functions don't exist in T014's set yet either).

- [X] T016 [IMPL] [US1] Add `generate_schedule(start_at, cadence_unit, cadence_interval, post_count) -> list[datetime]` inside `backend/app/core/scheduling.py` — co-located with `check_platform_gap` because both are scheduling math (analysis I3). Implements the cadence math from `data-model.md` §6 verbatim. Add a focused unit test `test_generate_schedule_weekly_four_posts` (or similar) to `test_scheduling.py` in the same TF cycle; write it alongside T014's test file (one test is enough since the math is trivial — Principle IV pragmatic for internal helpers, not Principle IX since `generate_schedule` is called from an API handler transitively).

- [X] T017 [IMPL] [US1] Edit `backend/app/main.py` to add `app.include_router(series.router, prefix="/api")` next to the existing `posts.router` registration. Restart backend (or rely on `--reload`). `GET http://localhost:8000/docs` now shows the `series` tag and the create endpoint. Smoke-test `POST /api/series` via Swagger.

**Checkpoint**: US1's create path is live. Commit.

---

## Phase 5: User Story 3 — Browse and manage series (backend) (Priority: P2)

**Goal**: GET list, GET detail with posts, PATCH metadata, DELETE with cascade. Ownership scoping enforced everywhere.

**Independent Test**: After creating a series in US1, `GET /api/series` returns it; `GET /api/series/{id}` returns it with embedded posts ordered by `series_position`; `PATCH /api/series/{id}` updates only `title`/`description`; `DELETE /api/series/{id}` removes the series row AND all its posts in one transaction. A second user's series is invisible.

### Test-First — list / get / patch / delete

- [X] T018 [TF] [US3] Append to `backend/tests/test_series.py`: `test_list_series_scoped_to_owner` (create a series as user A, register user B, B's `GET /api/series` returns `[]`); `test_list_series_returns_summary_without_posts` (`SeriesSummary` shape — `posts` field absent or empty); `test_get_series_returns_posts_ordered_by_position` (4-post series; assert response `.posts[i].series_position == i`); `test_get_series_404_for_other_owner` (no leak); `test_patch_series_title_only` (200, response title updated; cadence/platform/start_at/post_count UNCHANGED; assert NO post titles changed per Clarify-Q8 frozen-titles rule); `test_patch_series_rejects_immutable_fields` (sending `cadence_unit` is silently ignored OR rejected — pick one and assert it consistently); `test_delete_series_cascades_posts` (create 4-post series, DELETE, assert series row gone AND `SELECT count(*) FROM posts WHERE series_id=?` is 0); `test_delete_series_unconditionally_cascades_published_posts` (per Clarify-Q5 / FR-006: pre-mark one of the 4 posts as `status="published"`, DELETE the series, assert that published post is gone too); `test_delete_series_404_for_other_owner`. Run `pytest tests/test_series.py`; **observe the new cases failing**.

- [X] T019 [IMPL] [US3] In `backend/app/api/series.py`, implement `GET /` (list summaries scoped to `owner_id`), `GET /{id}` (full detail with embedded posts ordered by `series_position`), `PATCH /{id}` (only `title` / `description` via `SeriesUpdate`; do not touch other fields), `DELETE /{id}` (rely on SQLAlchemy `cascade="all, delete-orphan"` from the `Series.posts` relationship; return `204`). All four use the existing `get_current_user_id` dependency and 404 for `series.owner_id != user_id`. Re-run `pytest tests/test_series.py`; **observe all green**.

**Checkpoint**: full backend story complete. `pytest backend/tests/` should be green: existing 14 tests + new invariant cases + new series cases. Commit.

---

## Phase 6: Frontend — Series UI (Priority: P1 + P2 mixed)

**Goal**: creators can browse, create, view, and delete series in the browser. PostsList shows series membership. Layout exposes the new Series area in the nav.

**Principle IX scope**: frontend code is **not** governed by Principle IX (it's not "backend API"). Principle IV (pragmatic test coverage) applies. The existing `frontend/src/api/client.test.js` uses Vitest; if time permits, add coverage for `seriesApi`. Skipping it is acceptable per Principle IV.

**Principle VII applies throughout**: every async action MUST show a loading state; every error MUST surface the server's `detail.message`; every empty list MUST show an empty state; the delete action MUST require confirmation; new pages MUST be reachable from `Layout.jsx` nav.

### Implementation

- [X] T020 [P] [US1] Edit `frontend/src/api/client.js` to export a `seriesApi` object next to `postsApi` with methods `list()`, `get(id)`, `create(data)`, `update(id, data)`, `remove(id)` (avoid `delete` keyword). Each delegates to the existing `api()` helper; URL prefix `/series`.

- [X] T021 [P] [US1] Create `frontend/src/pages/SeriesList.jsx`. Show a table of the user's series: columns Title, Platform, Cadence (`every {interval} {unit}`), Posts (`post_count`), Start (`scheduled_at` of position 0, computed from cadence math or just shown as `start_at`). Loading state: `<div className="loading">Loading series…</div>`. Empty state: `<p>No series yet. <Link to="/series/new">Create one</Link>.</p>`. Top-right `New series` button linking to `/series/new`.

- [X] T022 [P] [US1] Create `frontend/src/pages/SeriesEdit.jsx` (create-only for v1). Form fields: title (required), description (optional), platform (`<select>` with the same five values as `PostEdit.jsx`), `start_at` (`<input type="datetime-local">`), cadence_unit (`<select>` of `days`/`weeks`), cadence_interval (`<input type="number" min="1" max="30">`), post_count (`<input type="number" min="1" max="20">`). Below the form, render a live preview list of the N computed `scheduled_at` values using the same `start_at + i * step` math from `data-model.md` §6 (use `date-fns/addDays`, `addWeeks`). On submit: `seriesApi.create(payload)`; on success, `navigate(\`/series/${created.id}\`)`; on 409 / 4xx, render `error.message` (never replaced with generic copy — Principle X) in an inline error box; on 422 (Pydantic validation), render the field-specific messages.

- [X] T023 [P] [US3] Create `frontend/src/pages/SeriesDetail.jsx`. Top: series metadata (title, description, platform badge, cadence summary, start, post count). Below: a table of the embedded `posts` with columns Position, Title, Scheduled, Status, Edit (link to `/posts/${id}/edit`). Top-right: a single **`Delete series`** button — **no `Edit series` button in v1** (decision per analysis I2; editing `title`/`description` in-place would require a SeriesEdit-in-edit-mode form that is out of scope for this iteration; reviewers can still PATCH via `/docs` if they need to). The delete button MUST open a confirmation dialog (a simple `window.confirm("Delete this series and all its posts?")` is acceptable per Principle VII timebox). On confirm, call `seriesApi.remove(id)`, then `navigate("/series")`. Loading + error states standard (Principle VII).

- [X] T024 [US1+US3] Edit `frontend/src/components/Layout.jsx` to add `<Link to="/series">Series</Link>` between `<Link to="/calendar">Calendar</Link>` and `<Link to="/posts/new">New Post</Link>`. New features must be reachable from the nav (Principle VII).

- [X] T025 [US1+US3] Edit `frontend/src/App.jsx`. Add three routes inside the existing `<ProtectedRoute><Layout/></ProtectedRoute>` block: `<Route path="series" element={<SeriesList />} />`, `<Route path="series/new" element={<SeriesEdit />} />`, `<Route path="series/:id" element={<SeriesDetail />} />`. Import the three new page components.

- [X] T026 [US1] Edit `frontend/src/pages/PostsList.jsx`. After loading posts, render a small inline badge next to the title for any post with truthy `series_id`: `<span className="series-badge">Series #{p.series_id}</span>` linking to `/series/${p.series_id}`. Keep it visually subtle. No restructuring of the existing table.

- [X] T027 [P] [US1] (OPTIONAL — Principle IV pragmatic) Add a Vitest test in `frontend/src/api/client.test.js` covering `seriesApi.list()`, `seriesApi.create()`, and `seriesApi.remove()` happy paths against a mocked `fetch`. Skip if timeboxed.

**Checkpoint**: end-to-end demoable. Open browser → log in → click `Series` in nav → click `New series` → fill form → see posts appear in `Posts` list with badge → click into series detail → delete series with confirmation → posts gone.

---

## Phase 7: Polish & Cross-Cutting

**Purpose**: docs, smoke checks, PR.

- [X] T028 [P] Edit `readme.md` to add a short "Content Series" section between the existing "Run with Docker" and "Running tests" sections. 5–10 lines: explain that creators can plan campaigns under `/series`, that the 15-min same-platform rule is enforced, and that `POST /api/series` is the bulk endpoint. Link to `specs/002-content-series/quickstart.md` for the demo walkthrough.

- [X] T029 [P] Run the **full** backend suite: `cd backend && pytest`. Confirm pre-existing tests still pass plus all new cases (target ~30+ tests). Run `cd frontend && npm run test && npm run lint`. Confirm Vitest still 16+ green and ESLint exits 0 (legacy warn-level rules from `001-docker-compose` remain).

- [X] T030 [P] Run `docker compose build` to confirm the existing CI `compose-build` job will still pass.

- [X] T031 Manual UI smoke per **Principle VII**: (a) Happy path — `cp backend/.env.example backend/.env && docker compose up`, log in, create a 4-post weekly series, see all 4 in `/`, see them in `/calendar`, drill into `/series/:id`. (b) **Failure path** — create an Instagram post 5 min after a future timestamp; submit a series whose first generated post hits that window; observe the 409 error toast surfaces the server's `detail.message` verbatim. (c) **Empty state** — fresh user (register a new account); `/series` shows "No series yet — create one" copy. (d) **Destructive confirmation** — delete a series; the confirm dialog appears; cancel keeps the series intact; confirm removes it. Record results in the PR description.

- [X] T032 (OPTIONAL — done) Edit `backend/scripts/seed_data.py` to create one example weekly 4-post series per seeded user. Skip if timeboxed; existing seed already gives reviewers visible data.

- [X] T033 Audit `git diff main -- backend/app/core/database.py backend/app/core/scheduling.py backend/app/models/ backend/app/schemas/ backend/app/api/ backend/app/main.py frontend/src/api/client.js frontend/src/pages/ frontend/src/components/Layout.jsx frontend/src/App.jsx` and confirm: (a) no stray `console.log`, `print()`, or commented-out code (Principle VIII), (b) no emoji in source code (Principle VIII), (c) no edits to `frontend/src/pages/PostEdit.jsx` per FR-005a, (d) no edits to `backend/scripts/seed_data.py` unless T032 was completed.

- [X] T034 Draft the PR description per **Constitution Principle V**. Required sections: **Approach** (Series-only scheduling per Clarifications Q1; idempotent ALTER for migration per Q2; the seven Clarify answers); **Assumptions** (verbatim from `spec.md` Assumptions block); **Tradeoffs** (the constitution-deviation table — none required for v1.2.0 since IX was adopted not grandfathered); **What I'd improve with more time** (multi-platform series; smart-cascade on rename per Clarify-Q8 option C; option B for cascade-with-history per Clarify-Q5; Postgres + Alembic; index on `posts.series_id`; SERIALIZABLE isolation; offload platform-side cancellation to a queue); **Loom link** (TODO until recorded). Reference the constitution version (v1.2.0) and which principles each amendment honors.

- [ ] T035 Push branch and open the PR. Paste the description from T034. Verify CI runs all four `001-docker-compose` jobs green: `backend-tests` (now ~30+ tests), `frontend-tests`, `frontend-lint`, `compose-build`. Attach the green-run link to the PR description.

- [ ] T036 (OPTIONAL but encouraged) Record a 5–10 minute Loom: (a) `docker compose up` → working app, (b) create a series in the UI with the live preview, (c) attempt a 409-triggering series → toast surfaces server message verbatim, (d) walk through `scheduling.py` and `test_scheduling.py` highlighting the test-first commit history per Principle IX, (e) note the 8 Clarifications and the constitution v1.2.0 amendments. Paste link in the PR description.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: nothing.
- **Foundational (Phase 2)**: Setup; blocks every other phase.
- **US2 (Phase 3)**: Foundational. Blocks US1 because series-create calls `check_platform_gap`.
- **US1 backend (Phase 4)**: Foundational + US2.
- **US3 backend (Phase 5)**: Foundational + US1 (needs the create endpoint and series rows to test against).
- **Frontend (Phase 6)**: backend phases done OR can start in parallel against the contracts (some frontend tasks depend on real endpoint URLs but can be built against the documented contracts ahead of time).
- **Polish (Phase 7)**: everything else.

### Within each user story (Test-First)

For backend API tasks:

- `[TF]` test task → run pytest, **observe failing** → commit (or proceed but note in next commit).
- `[IMPL]` implementation task → re-run pytest, **observe passing** → commit.
- The implementation task MUST NOT run before its `[TF]` partner produced a failing run. Skipping the failing-state observation is a Principle IX violation (NON-NEGOTIABLE).

### Parallel Opportunities

- T002, T003, T004 (different model files) — `[P]`.
- T006 and T007 (different schema files) — `[P]`.
- T020, T021, T022, T023 (different frontend files) — `[P]`.
- T028, T029, T030 (independent polish tasks) — `[P]`.
- Backend Phase 3 (US2) and frontend Phase 6 visual scaffolding can overlap once contracts are stable — frontend tasks T020–T023 can begin against the contracts in `specs/002-content-series/contracts/series-api.md` while backend Phases 4 and 5 are still being implemented.

---

## Parallel Example: Foundational Phase

```bash
# T002, T003, T004 are different files — launch in parallel:
Task: "Create backend/app/models/series.py"               # T002
Task: "Edit backend/app/models/post.py"                   # T003
Task: "Edit backend/app/models/user.py"                   # T004

# After those land:
Task: "Update backend/app/core/database.py with idempotent ALTER"   # T005

# T006 and T007 are independent schema files:
Task: "Create backend/app/schemas/series.py"              # T006
Task: "Edit backend/app/schemas/post.py"                  # T007
```

## Parallel Example: US2 Test-First Cycle

```bash
# Tests come first; cannot parallelize across the [TF]/[IMPL] boundary.
Task: "Write test_scheduling.py and observe failing"      # T008
Task: "Implement scheduling.py and observe passing"       # T009 (sequential after T008)

# But the next pair can start in parallel with the previous pair's IMPL:
Task: "Write test_posts.py invariant cases"               # T010 (after T009)
Task: "Wire invariant into posts.py"                      # T011 (sequential after T010)
```

---

## Implementation Strategy

### MVP First (ship US2 + US1 backend, defer US3 + frontend)

1. Phase 1 + Phase 2 (T001–T007).
2. Phase 3 US2 fully (T008–T013) — this alone fixes the assignment's hard constraint.
3. Phase 4 US1 backend fully (T014–T017).
4. **STOP and VALIDATE**: hit `POST /api/series` from `/docs`. The take-home's core requirement is functionally satisfied. Open a draft PR and decide whether to ship now or continue.

### Incremental Delivery

1. Foundation + US2 → green tests, invariant enforced.
2. US1 backend → series-create works.
3. US3 backend → full series CRUD.
4. Frontend → demoable in the browser.
5. Polish + PR.

### Cutting order under time pressure

If at any point the timebox is about to blow:

1. **Cut T032** (seed enrichment) first.
2. **Cut T027** (Vitest for `seriesApi`) — Principle IV permits.
3. **Cut T036** (Loom video) — record after the PR is open.
4. **Cut T026** (PostsList badge) — series detail page already shows membership.
5. **Cut T023** (SeriesDetail page) — users can still see their series in `/series` list and edit individual posts via `/posts/:id/edit`.
6. **DO NOT cut Phase 3 (US2)**. The 15-min invariant is the assignment's one hard constraint and the constitution's NON-NEGOTIABLE Principle III.
7. **DO NOT cut the [TF] tasks**. Skipping test-first violates Principle IX (NON-NEGOTIABLE for backend API). The grandfather clause was explicitly NOT invoked in `Tasks-Q1`.

---

## Done criteria

- All `[TF]` test tasks demonstrably ran red before their paired `[IMPL]` task and green after — visible in commit history or commit messages.
- `cd backend && pytest` is green.
- `cd frontend && npm run test && npm run lint` is green (lint exits 0; the two pre-existing warn-level rules from `001-docker-compose` remain warn-level).
- `docker compose build` is green.
- Manual UI smoke (T031) covered all four Principle VII checkpoints.
- PR description contains the five elements from Principle V plus a Principle IX compliance note.
- CI (the four jobs from `001-docker-compose`) is green on the PR.

---

## Notes

- Test-First is mandatory for **every** task tagged `[TF]` — this is the explicit application of Principle IX adopted via `Tasks-Q1`.
- `[P]` marks tasks that touch different files and have no dependency on incomplete tasks. Within a TF cycle, `[TF]` and `[IMPL]` are sequential by definition.
- No edits permitted to `backend/scripts/seed_data.py` (unless T032 is taken), `frontend/src/pages/PostEdit.jsx` (per FR-005a), or any of the auth-related modules.
- Commit after each task or each `[TF]`/`[IMPL]` pair so the failing-then-passing transition is visible to reviewers and to the CI history.
- Stop at any checkpoint to demo or hand off.
