# Gaps: current code vs. REQUIREMENTS.md

Inventory of what's already present vs. what has to be built for Content
Series. Derived from reading the working tree (2026-04-22).

## Backend

| File | Current state | Needed change | Severity |
| --- | --- | --- | --- |
| `backend/app/models/user.py` | Has `posts` relationship | Add `series` relationship | Trivial |
| `backend/app/models/post.py` | `id`, `title`, `platform`, `scheduled_at`, `status`, `owner_id`, timestamps | Add `series_id` (FK, nullable), `series_position` (int, nullable) | Small |
| `backend/app/models/series.py` | **does not exist** | Create the full `Series` model | New file |
| `backend/app/schemas/post.py` | `PostCreate`/`PostUpdate`/`PostResponse` | Add `series_id` and `series_position` to `PostResponse` | Small |
| `backend/app/schemas/series.py` | **does not exist** | Create `SeriesCreate`, `SeriesUpdate`, `SeriesResponse` | New file |
| `backend/app/api/posts.py` | CRUD with **no scheduling checks** | Wire in the 15-min invariant on create + update | Small but critical |
| `backend/app/api/series.py` | **does not exist** | Full CRUD + bulk-materialize-with-invariant | New file |
| `backend/app/core/scheduling.py` | **does not exist** | `check_platform_gap` pure function | New file |
| `backend/app/main.py` | Includes `auth`, `posts` routers | Add `series` router | One line |
| `backend/app/core/database.py` | `init_db` creates tables from `Base.metadata` | Adding the Series model is auto-picked; no migration code needed (SQLite fresh-start is fine, the entrypoint re-seeds if empty) | None |
| `backend/scripts/seed_data.py` | Seeds users + random posts | **OPTIONAL**: add one example series per user for demo purposes. Constitution-tagged as don't-touch-required by the `001-docker-compose` feature, but that was scoped to that feature only; for the Series feature it is in scope. | Optional |
| `backend/tests/test_posts.py` | 9 tests, no invariant coverage | Add at least 2 tests: within-window rejection, exact-boundary acceptance | Small |
| `backend/tests/test_series.py` | **does not exist** | Happy-path + conflict-abort + ownership + delete-cascade | New file |

## Frontend

| File | Current state | Needed change | Severity |
| --- | --- | --- | --- |
| `frontend/src/api/client.js` | `authApi`, `postsApi` | Add `seriesApi` (list/get/create/update/delete) | Small |
| `frontend/src/pages/PostsList.jsx` | Flat table | Add a "Series: {title}" badge column (or inline next to title) when `series_id` present | Small |
| `frontend/src/pages/PostEdit.jsx` | Single-post form | No change required for v1 (editing a series post is the same as editing any post) | None |
| `frontend/src/pages/CalendarPage.jsx` | All events same color | **Optional polish**: color-code by series id | Optional |
| `frontend/src/pages/SeriesList.jsx` | **does not exist** | New: list all series | New file |
| `frontend/src/pages/SeriesEdit.jsx` | **does not exist** | New: create form with cadence preview | New file |
| `frontend/src/pages/SeriesDetail.jsx` | **does not exist** | New: series metadata + its posts | New file |
| `frontend/src/components/Layout.jsx` | Nav with Posts / Calendar / New Post / Logout | Add `Series` link | One line |
| `frontend/src/App.jsx` | Routes for posts + calendar | Add `/series`, `/series/new`, `/series/:id` routes | ~5 lines |

## Tests

| Area | Current | Required | Why |
| --- | --- | --- | --- |
| 15-min invariant (same platform, same user, within window) | **untested** | at least one failing case | Constitution Principle III is NON-NEGOTIABLE |
| 15-min invariant (exact-boundary) | untested | passing case at exactly 15 minutes | Prove off-by-one correctness |
| 15-min invariant (different platform, same time) | untested | passing case | The rule is platform-scoped |
| Series creation happy path | untested | passing case | Basic feature coverage |
| Series creation with invariant conflict | untested | 409 + no partial writes | Principle IV (test the risky path) |
| Series ownership scoping | untested | user B cannot see user A's series | Existing pattern for posts |
| Series delete cascade | untested | delete series → posts removed | Default behavior chosen |

## Infra (already done on `001-docker-compose`)

| Item | Status |
| --- | --- |
| `docker compose up` one-command local stack | ✓ |
| CI on every PR (pytest, vitest, eslint, compose-build) | ✓ |
| Seed-on-empty gate | ✓ |
| Shared `backend/scheduler.db` across venv + Docker | ✓ |

The Series feature inherits all of the above. CI will automatically run its
new tests. No infra change needed.

## Constitution deltas carried into this feature

Two deviations from the merged infra PR are still open and should stay
scoped out of the Series PR unless they block it:

1. Backend Python lint (Ruff) — deferred (FR-012c).
2. Legacy `AuthContext.jsx` ESLint violations downgraded to `warn` — fixing is a separate follow-up.

Adding Ruff or fixing those is attractive but out of scope for v1 of Series.
