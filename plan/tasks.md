# Tasks: Content Series

Ordered execution checklist for the ~3-hour implementation. Companion to
[`README.md`](./README.md) and [`data-model.md`](./data-model.md). Task IDs
and format mirror the `specs/001-ci-docker-compose/tasks.md` file so the
same reviewer rhythm applies.

## Phase 0 — Branch + prep (5 min)

- [ ] P0-1 Ensure `001-docker-compose` PR is merged (or at least running green CI); create `002-content-series` from `main`.
- [ ] P0-2 Skim `plan/README.md`, `plan/data-model.md`, `plan/gaps.md`. Resolve Open Questions 1–4 (assume the documented defaults unless a reviewer has weighed in).

## Phase A — Scheduling invariant (30–45 min) 🎯 critical

**Gate**: no subsequent phase may merge without this phase green.

- [ ] A-1 Create `backend/app/core/scheduling.py` with the `Conflict` dataclass and `check_platform_gap(db, owner_id, platform, scheduled_at, exclude_post_id=None)` as described in `plan/data-model.md`. Use `BUFFER = timedelta(minutes=15)` as a module constant.
- [ ] A-2 Wire `check_platform_gap` into `backend/app/api/posts.py`:
  - `create_post`: call before `db.add`; on conflict, `raise HTTPException(409, detail={...})`.
  - `update_post`: call when `scheduled_at` is in the update payload OR when `platform` is in the update payload AND the post has a `scheduled_at`; pass `exclude_post_id=post.id`.
- [ ] A-3 Add tests to `backend/tests/test_posts.py`:
  - `test_create_rejects_within_15_min_same_platform` — 10 min apart → 409.
  - `test_create_accepts_exactly_15_min_same_platform` — exact boundary → 201.
  - `test_create_accepts_same_time_different_platform` — 201.
  - `test_patch_self_does_not_conflict` — PATCH a post's own title while keeping its `scheduled_at` → 200.
- [ ] A-4 Run the backend suite locally; confirm all pre-existing tests still pass plus the 4 new ones (total 14 → 18). Run via `docker compose run --rm backend pytest` for parity with CI.

**Checkpoint**: You can ship Phase A alone and it would already be a meaningful PR. Don't.

## Phase B — Series backend (45–60 min)

- [ ] B-1 Create `backend/app/models/series.py` defining `Series` with the columns from `plan/data-model.md`. Add `User.series` relationship in `backend/app/models/user.py`.
- [ ] B-2 Edit `backend/app/models/post.py`: add `series_id` (nullable FK) and `series_position` (nullable int); add `series` relationship.
- [ ] B-3 Edit `backend/app/schemas/post.py`: add `series_id` and `series_position` as optional fields on `PostResponse`.
- [ ] B-4 Create `backend/app/schemas/series.py` with `SeriesBase`, `SeriesCreate`, `SeriesUpdate`, `SeriesResponse`. Use `Literal` types for `platform` and `cadence_unit`; use `Field(ge=..., le=...)` for numeric bounds.
- [ ] B-5 Create `backend/app/api/series.py`:
  - Router prefixed `/series`, tags `["series"]`.
  - `POST /`: validate input, compute N `scheduled_at` values, precheck pairwise gaps among the N, then per-post call `check_platform_gap`, then materialize series + all N posts atomically; return `SeriesResponse` with `posts` populated.
  - `GET /`: list owner's series (lightweight, no posts embedded).
  - `GET /{id}`: full detail including posts ordered by `series_position`.
  - `PATCH /{id}`: title/description only.
  - `DELETE /{id}`: cascade via ORM relationship.
- [ ] B-6 Register the router in `backend/app/main.py` (one line: `app.include_router(series.router, prefix="/api")`).
- [ ] B-7 Create `backend/tests/test_series.py` covering:
  - `test_create_series_happy_path` — 4 posts, weekly cadence, all scheduled correctly, all tagged with `series_id` and correct `series_position`.
  - `test_create_series_aborts_on_conflict` — seed a blocking post first, then attempt create, assert 409 + `SELECT count(*) FROM posts` unchanged + no `series` row created.
  - `test_list_series_scoped_to_owner` — two users' series are isolated.
  - `test_get_series_includes_posts_ordered_by_position` — posts returned in 0,1,2,... order.
  - `test_delete_series_cascades_posts` — series delete removes its posts.
  - `test_series_create_requires_auth` — 401.
- [ ] B-8 Reset the dev DB (`docker compose down && rm -f backend/scheduler.db && docker compose up`) to pick up the schema change. Manually hit `/docs`, call `POST /api/series`, confirm round-trip.

**Checkpoint**: Full backend story. Postman/curl users can demo; frontend is next.

## Phase C — Frontend series UI (45–60 min)

- [ ] C-1 Edit `frontend/src/api/client.js`: export `seriesApi` with `list`, `get`, `create`, `update`, `delete` methods mirroring `postsApi`.
- [ ] C-2 Create `frontend/src/pages/SeriesList.jsx`: table with columns `Title`, `Platform`, `Cadence` ("every N days"), `Posts`, `Start`. "New series" button linking to `/series/new`. Empty-state message.
- [ ] C-3 Create `frontend/src/pages/SeriesEdit.jsx` (create-only for v1): fields for title, description, platform (same dropdown as `PostEdit`), `start_at` (datetime-local), `cadence_unit` + `cadence_interval`, `post_count`. Live-preview the N computed timestamps below the form. On submit, handle 409 by showing `detail.message` in the error box without clearing the form.
- [ ] C-4 Create `frontend/src/pages/SeriesDetail.jsx`: series metadata at top; table of posts below (title + `scheduled_at` + status + Edit link).
- [ ] C-5 Edit `frontend/src/App.jsx`: add three routes — `/series`, `/series/new`, `/series/:id` — all inside the existing `<ProtectedRoute><Layout/></ProtectedRoute>` subtree.
- [ ] C-6 Edit `frontend/src/components/Layout.jsx`: add `<Link to="/series">Series</Link>` in the nav.
- [ ] C-7 Edit `frontend/src/pages/PostsList.jsx`: when a row's `series_id` is truthy, render a small badge (inline with the title) showing "Series #{series_id}" for now; polish to show title later if time allows.
- [ ] C-8 Manual smoke: log in as `alice@example.com`, create a 4-post weekly series, see it in `/series`, drill into detail, confirm the same posts show up in `/` (PostsList) with the series badge and in `/calendar`.

**Checkpoint**: End-to-end demo-able.

## Phase D — Seed + polish + PR (15–30 min)

- [ ] D-1 (Optional; skip if timeboxed) Extend `backend/scripts/seed_data.py` to create one example series per seeded user — e.g., a weekly 4-post "Launch campaign" series on a random platform. Keep the existing random-post generation.
- [ ] D-2 Update `readme.md` with a short "Content Series" section (3–5 lines) pointing at `/series` and `POST /api/series`.
- [ ] D-3 Draft the PR description per constitution Principle V. Required sections: Approach, Assumptions, Tradeoffs, What I'd improve with more time, Loom link. Include a dedicated "Scheduling invariant" subsection in Approach (this is the assignment's hard constraint).
- [ ] D-4 Confirm `git diff main -- frontend/eslint.config.js` is empty (lint config is not this feature's concern) and that no new unjustified deviations from the constitution are present.
- [ ] D-5 Push branch, open PR into own `main`, paste description body.
- [ ] D-6 Record a 5–10 min Loom: (a) create a series in the UI, (b) show the 15-min rule blocking a manual post, (c) walk through `scheduling.py` and the `test_create_rejects_within_15_min_same_platform` test, (d) note the open questions and tradeoffs.
- [ ] D-7 Paste Loom URL into the PR description.

## Cutting order under time pressure

If at any point the timebox is about to blow:

1. **Cut D-1** first (seed data enrichment). The UI still works with manually-created series.
2. **Cut C-7** (post-list badge). The series detail page already shows series membership.
3. **Cut C-4** (SeriesDetail). Users can still click Edit on the materialized posts from `/` to see their scheduled times.
4. **Cut the optional CalendarPage color-coding** (wasn't in the task list; don't add it on top).
5. **DO NOT** cut Phase A. The invariant is the one hard constraint.
6. **DO NOT** cut B-7 test-for-conflict-abort. That's the reviewer's second-most-likely question.

If you end up shipping only A + B + C-1..C-3 + C-5..C-6 + D-2..D-7: the
assignment is still complete. You have a visible Series form, generated
posts showing up in the existing PostsList + Calendar, and an enforced
15-min rule with tests.

## Done criteria

- All CI jobs green on the feature branch.
- `/api/series` round-trip works; 15-min rule blocks bad input with 409.
- `POST /api/posts` also enforces the 15-min rule.
- Frontend: can create a series, see its posts, see the series badge in
  PostsList (if C-7 shipped) or the series detail page (if C-4 shipped).
- PR open with the required description sections + Loom.
