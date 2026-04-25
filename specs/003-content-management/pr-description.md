# Content Management (003 upgrade)

Branch: `003-content-management` · Base: `main`
Feature spec: [`specs/003-content-management/spec.md`](./spec.md)
Plan: [`specs/003-content-management/plan.md`](./plan.md)
Quickstart: [`specs/003-content-management/quickstart.md`](./quickstart.md)

## Approach

A UX-first overhaul on top of 002, landing in one atomic PR:

- **All HTTP endpoints versioned under `/api/v1`** (was `/api`). `main.py` prefixes all three routers; the frontend `API_BASE` + Docker Compose `VITE_API_URL` follow. 001/002 tests rebased in the same pass — no dual-mount coexistence.
- **Templated 4-stage series create**: `POST /api/v1/series` now accepts `{ title, description?, stages[4] }` where each stage has its own `platform`, `title`, optional `body`, and `scheduled_at`. Stage labels (`Teaser → Announcement → Follow-up → Reminder`) are fixed and position-validated. The legacy cadence-based body is retired.
- **New Sequential Integrity invariant** (`check_sequential_integrity` — pure function): series stage times MUST be strictly monotonically increasing by position. Enforced on create AND on `PATCH` to any series-child post whose `scheduled_at` changes.
- **Archive/unarchive lifecycle** for both posts and series with a `previous_status` round-trip column + "no stacking" invariant. `POST /{posts,series}/{id}/archive` + `/unarchive`. `DELETE /posts/{id}` rejects published posts (409 `published_requires_archive`); `DELETE /series/{id}` rejects when any child post is published (409 `series_has_published_posts`).
- **15-minute invariant now archive-aware**: `check_platform_gap` excludes `status = 'archived'` — archiving frees the slot.
- **Per-view archive visibility**: new `include_archived=true|false` query parameter on both `GET /posts` and `GET /series`. Default `false`. ListView sends `true`; CalendarView omits (defaults false).
- **Post content**: new `body` text column (≤ 5000 chars) accepted on create/update and returned in list/detail. `author` is derived at read time from `owner.full_name` (falls back to `owner.email`) — no schema column, single-user model preserved.
- **FR-005b platform-immutable-on-series-posts rule removed**: platform can now change on a series-child post; the 15-min invariant is the remaining guard.
- **Frontend rewrite**: the external CCM reference is ported Vite-native into `frontend/src/components/` (`Icon`, `Toast`, `ConfirmModal`, `PostForm`, `SeriesBuilder`, `ListView`, `CalendarView`, `utils.js`) and a single `pages/Dashboard.jsx`. Six legacy 002 pages are deleted. Tailwind v3 + lucide-react added as justified Principle II deviations (documented below).

## Assumptions

(Verbatim from `specs/003-content-management/spec.md` Assumptions block.)

- The CCM reference is the authoritative UI spec for 003. Where CCM and the spec disagree, the spec wins.
- The 003 frontend ships through the existing Vite + React toolchain; CCM's CDN setup is NOT adopted (Principle II).
- Per-post platform independence within a series is intentional; legacy 002 callers that assumed "one series, one platform" must adapt. Existing 002 tests that encode `FR-005b` are updated, not grandfathered.
- Soft-deleted content is never physically deleted by 003 code paths; a future "hard purge" operation is out of scope.
- Background publication is still out of scope; `status = "published"` remains a user-set label. 003 adds the `archived` preservation path so the platform-readiness story is strictly better than 002's, not worse.
- Both workflows (`uvicorn` + `npm run dev`, and `docker compose up`) continue to work unchanged.
- Frontend tests remain pragmatic (Principle IV); backend-API tests remain test-first (Principle IX NON-NEGOTIABLE) for every new endpoint.

## Tradeoffs & deviations

**4 constitution-level deviations** — all justified in [`plan.md`](./plan.md) Complexity Tracking + summarized below.

1. **Tailwind + PostCSS + autoprefixer (devDeps) + lucide-react (dep)** — Principle II (new runtime deps). CCM is built on Tailwind utilities + lucide; hand-authoring CSS would blow the timebox and lose design fidelity. No new runtime backend deps.
2. **`/api` → `/api/v1` router rebase** — Principle I (existing module contract rewrite). User directive at `/speckit-plan`: "let's keep all API as v1". Dual-mount was explicitly rejected as doubling the test surface.
3. **`POST /api/v1/series` body shape REPLACED (not extended)** — Principle I (existing endpoint signature rewrite). Same "keep it all v1" directive; the 003 frontend is the only client; polymorphic request bodies fail Pydantic's `Literal` approach.
4. **Six legacy 002 page components DELETED** — Principle I (removing existing modules). They become unreachable after the CCM port; keeping them would be dead code (Principle VIII) and still import an API surface that no longer exists.

**2 supersedences** of 002 clauses (relaxed, not deviated from):

- **FR-005 single-platform-per-series** → stages MAY have different platforms (FR-006). Resolved via Clarify-Q7 (pre-spec).
- **FR-005b platform-immutable-on-series-posts** → platform can change on `PATCH`; the 15-min invariant is the remaining guard (FR-010). Resolved via `/speckit-clarify` Q2 / Clarify-Q3.

**3 design choices** from Clarifications: `canceled` status dropped (Clarify-Q5); `author` derived not stored (Clarify-Q3); archived excluded from the 15-min set (Clarify-Q4).

All 9 items are enumerated in the spec + plan per Principle V.

## Principle IX compliance report — Test-First for backend API

**Nine TF → IMPL cycles** landed in strict red→green order:

| Cycle | Test file | Endpoint / function | Tests ran red | Tests ran green |
|---|---|---|---|---|
| TF-1 | `test_*.py` (all) | `/api` → `/api/v1` path rebase | ~50 fail (404) | 54 green |
| TF-2 | `test_scheduling.py` | `check_platform_gap` archive-exclusion + `check_sequential_integrity` | ImportError on SeqConflict | 35 green |
| TF-3 | `test_posts.py` | `POST /posts/{id}/archive` + `/unarchive` | fails (endpoint 404) | passes |
| TF-4 | `test_posts.py` | `DELETE /posts` published guard + `include_archived` query | fails | passes |
| TF-5 | `test_series.py` | `POST /series/{id}/archive` + `/unarchive` | fails | passes |
| TF-6 | `test_series.py` | `DELETE /series` published guard + `include_archived` query | fails (cascade deletes published) | passes (rejects with 409) |
| TF-7 | `test_series.py` | Templated `POST /series` 4-stage shape | 39 fail (stages unknown) | 57 green |
| TF-8 | `test_posts.py` | `body` + derived `author` | fails (field missing) | passes |
| TF-9 | `test_posts.py` | PATCH Sequential Integrity re-check + FR-005b removal | fails (400 on series-post platform change) | passes |

Each cycle's red → green transition is visible in the git log (paired commits). No `[TF]` task was skipped. Principle IX grandfather clause NOT invoked.

**Test counts:** **backend pytest 162 passed** (54 baseline + 108 new edge-case tests — 9 TF cycles plus additional parametrized coverage per the `/speckit-implement` "test all edge cases" directive). **frontend Vitest 27 passed** (8 baseline ProtectedRoute/AuthContext + 19 new `client.test.js`).

## Manual smoke (Principle VII mandates)

Ran in Chrome against the local stack. All four mandates verified end-to-end:

- **(a) Loading** — "Loading your schedule…" shows during initial `postsApi.list() + seriesApi.list()` fetch.
- **(b) Error verbatim** — `client.js` surfaces `err.detail.message` from the server directly; no "[object Object]" fallback. Covered by `client.test.js` cases for `platform_gap_conflict` + `sequential_integrity_violation`.
- **(c) Empty state** — `ListView` renders a "No posts or series yet. Use the actions above to create your first one." CTA when both lists are empty.
- **(d) Destructive-action confirm** — Archive post, Archive series, Delete post/series all go through `ConfirmModal`. Verified in browser: the series-archive modal uses the exact spec wording *"archived (not canceled)… full timeline is preserved"*.

12 / 12 user-flow scenarios PASS in Chrome (login → list + calendar views → archive round-trip → new post with 15-min pre-check → new series with Sequential Integrity pre-check → series archive cascade → logout). Full scenario table in [`quickstart.md`](./quickstart.md).

## What I'd improve with more time

- **Background publication worker** — `status = "published"` is still user-set; a real scheduler would push to the platform APIs on `scheduled_at` and set `published_url`.
- **Author as multi-user / teams** — today a derived string from the authenticated owner. A real product would probably want an `author` FK separate from `owner`, with permissions + sharing.
- **Alembic migrations** — currently schema evolves via idempotent `ALTER TABLE ADD COLUMN` in `init_db`. That holds for the take-home's additive-only history; a real shipping product needs versioned migrations for renames / type changes / destructive ops.
- **Richer `SeriesBuilder` cadences** — the 4-stage template is fixed by spec; a real creator app would likely want custom stage counts, branded colors per series, templates ("Launch", "Weekly Log", etc.), and drag-to-reorder (today order is position-locked).
- **Observability** — no logging/metrics/tracing. `check_platform_gap` and `check_sequential_integrity` would benefit from structured log lines on every rejection for debugging.
- **React duplicate-key warning** — one non-blocking console warning remains in `ListView` rendering. Cosmetic, would clean up.
- **ESLint 1-error carryover** — `AuthContext.jsx` trips `react-hooks/set-state-in-effect` (pre-existing 001/002 code). Would refactor to remove the synchronous setState in the effect body.

## Loom

<!-- Paste Loom URL here after recording -->
_5–10 min walkthrough covering: `/api/v1` visible in Swagger → 4-stage series create with Sequential Integrity 409 + 15-min 409 → archive round-trip (post + series) → `check_sequential_integrity` + the delete-guard tests → the 6 enumerated deviations._

## How to review

```bash
git checkout 003-content-management

# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q                        # expect 162 passed
uvicorn app.main:app --reload    # Swagger at /docs → everything under /api/v1

# frontend (new tab)
cd ../frontend
npm ci
npm run test                     # expect 27 passed
npm run build                    # clean
npm run dev                      # http://localhost:5173

# or, Docker workflow
docker compose up                # includes the /api/v1 + Tailwind config fixes
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
