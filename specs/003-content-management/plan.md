# Implementation Plan: Content Management (003 upgrade)

**Branch**: `003-content-management` | **Date**: 2026-04-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-content-management/spec.md`

## Summary

003 is a UX-first upgrade of 002. The backend gains six new endpoints
(archive / unarchive for posts and series, a redesigned series-create
flow, and a sequential-integrity-aware update path), four additive
columns on `posts` (`body`, `published_url`, `stage`,
`previous_status`), two on `series` (`status`, `previous_status`), one
new enum value (`archived`), and an updated `check_platform_gap` that
excludes archived posts. The frontend ports the external CCM reference
implementation (`/Users/yuxuanhu/Desktop/takehome/Creator-Content-Management/`)
into the existing Vite + React toolchain, adds Tailwind as a devDep,
and replaces the 002 pages with a single `Dashboard.jsx` plus
co-located component files.

Two structural decisions codified in this re-plan:

- **All HTTP endpoints versioned under `/api/v1`** (backend `main.py`
  updates the router prefix; `client.js` updates `API_BASE`). This is
  a breaking change to 001/002 callers; 001/002 tests are updated in
  the same PR. No `/api/v2` namespace is introduced — there is one
  API version, and this 003 upgrade ships inside it.
- **No `v2/` subtree in the frontend.** Ported CCM components go
  directly into `frontend/src/components/` and the single unified
  page sits at `frontend/src/pages/Dashboard.jsx`. The 002 pages
  (`PostsList`, `PostEdit`, `SeriesList`, `SeriesEdit`, `SeriesDetail`,
  `CalendarPage`) are DELETED — not left on disk — because they are
  no longer routable.

The 13 clarifications already in `spec.md` (8 pre-spec + 5 clarify
session) authoritatively define every non-trivial behavior. No
unresolved conflicts known at this gate.

## Technical Context

**Language/Version**: Python 3.11 (backend, CI, Docker image — unchanged from 002), Node 20 LTS (frontend, CI, Docker image — unchanged).
**Primary Dependencies**:
- Backend (unchanged from 002): FastAPI, SQLAlchemy 2 async, aiosqlite, pydantic v2, python-jose, bcrypt.
- Frontend (existing): React 19, Vite 7, React Router 7, date-fns, react-big-calendar.
- Frontend (new in 003, justified): **tailwindcss** (devDep) + **postcss** + **autoprefixer** — matches CCM's design language and replaces ad-hoc CSS in the ported components. **lucide-react** — icon set used throughout CCM. Three new `devDependencies` (tailwindcss, postcss, autoprefixer) plus one `dependency` (lucide-react). Principle II ("new runtime deps SHOULD be avoided; when unavoidable the PR description MUST justify") is satisfied by the UX-driven necessity called out in `spec.md` Assumptions.
**Storage**: SQLite via SQLAlchemy async; additive schema changes rolled out via the existing idempotent `ALTER TABLE ADD COLUMN` block in `backend/app/core/database.py::init_db` (matches 002 FR-016 pattern). Reviewers upgrading from 002 do NOT reset their DB.
**Testing**: pytest 8 (`asyncio_mode=auto`) for backend, Vitest 2 + React Testing Library for frontend. Backend API endpoints MUST be test-first per Constitution Principle IX.
**Target Platform**: dev workstation (macOS/Linux/Windows Docker) + `ubuntu-latest` GitHub-hosted runners. Unchanged from 002.
**Project Type**: Web application (`backend/` + `frontend/`). Unchanged from 002.
**Performance Goals**: SC-001 (series create ≤ 2 min from empty form), SC-006 (archived filter renders in ≤ 1 s on ≤ 500 posts). CI total stays ≤ 5 min (002 SC-005 carries forward).
**Constraints**: ~3-hour implementation budget for this iteration; no changes to 001 infra; no changes to 002-era tests that are still valid (only relaxations for the two superseded 002 clauses — FR-005 single-platform, FR-005b platform-immutable on series posts). Constitution Principle IX NON-NEGOTIABLE for all new backend API endpoints.
**Scale/Scope**: per-owner small (single user, ≤ 500 posts, ≤ 50 series). No multi-user / sharing per Clarify-Q3.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version in effect: **v1.2.0** (10 principles).

| Principle | Evaluation | Status |
|---|---|---|
| I — Extend, Don't Rewrite | Backend changes are additive on schema + new endpoints. Breaking delta: `main.py` router prefix moves `/api → /api/v1`, and `backend/app/api/series.py::create_series` is rewritten to accept the new 4-stage body (legacy cadence shape is retired, not coexistent). Frontend ports CCM components directly into `frontend/src/components/` and introduces a single new `Dashboard.jsx`; six 002 pages are DELETED. These are justified rewrites under Principle I's "unless required to eliminate a genuine blocker" clause — keeping both API paths alive would double the test matrix, and keeping the 002 pages alive would leave dead routes referencing an API shape that no longer exists. Three explicit Principle-I deviations, all documented in Complexity Tracking. | Pass (three Principle-I deviations justified) |
| II — Stay on the Existing Stack | Backend: zero new runtime deps. Frontend: three new devDeps (tailwindcss, postcss, autoprefixer) + one new dep (lucide-react). **Justified deviation** — UX-driven necessity captured in spec Assumptions + this plan's Complexity Tracking. No new services / workers / DBs. | Pass (deviation documented) |
| III — Enforce Scheduling Invariants (NON-NEGOTIABLE) | `check_platform_gap` updated: excludes posts where `status = 'archived'` (FR-018) and gains a companion `check_sequential_integrity` pure function used by templated series. Every backend write path still calls the gap check; the new series-create + PATCH paths call both. Exact-15-min-boundary behavior unchanged. Tests extend 002's matrix with archive-exclusion + sequential-integrity cases. | Pass |
| IV — Pragmatic Test Coverage | Frontend gets Vitest coverage only where logic is non-trivial (the ported `SeriesBuilder` validation chain, the ported `findConflicts` helper). New backend endpoints get Principle IX test-first. Existing 54 backend tests + 22 frontend tests MUST stay green. | Pass |
| V — Clear Structure & Documented Tradeoffs | New backend additions land in existing files under natural namespaces; new frontend files sit directly in `frontend/src/components/` + a single new `frontend/src/pages/Dashboard.jsx`. PR description captures: **4 constitution-level deviations** (Tailwind + lucide-react under Principle II; `/api/v1` prefix rebase, series-create body rewrite, 6 legacy page deletions under Principle I — all 4 enumerated in Complexity Tracking) **+ 2 002-clause supersedences** (FR-005 single-platform-per-series and FR-005b platform-immutable — relaxed, not deviated from) **+ 3 design choices from Clarifications** (canceled dropped per Clarify-Q5, author derived per Clarify-Q3, archived excluded from invariant per Clarify-Q4). Deviations and supersedences count separately. | Pass |
| VI — Surface and Resolve Spec Conflicts (NON-NEGOTIABLE at execution gates) | 13 clarifications resolved before this plan: 8 pre-spec + 5 during `/speckit-clarify`. All in `spec.md` Clarifications + `questions/003-frontend-integration-pre-spec-answer.md`. No unresolved items at this gate. | Pass |
| VII — User-Friendly UI | Every new surface (ListView, CalendarView, Dashboard, PostForm, SeriesBuilder, ConfirmModal, Toast) carries the four mandates: loading, error toast verbatim from server `detail.message`, empty state with CTA, destructive-action confirmation. CCM's `ConfirmModal` pattern already embodies this. The ported `Toast` and `ConfirmModal` stay. `SeriesBuilder` pins the 15-min rule banner at the top (FR-003). | Pass |
| VIII — Code Quality — Idiomatic, Minimal, Reviewable | Port CCM to Vite-native (ES imports, no `window.*` globals). Keep names domain-forward (`Series`, `Stage`, `Teaser`). No emoji in source. Skip CCM's CDN babel-in-browser path. PR size: will be large but reviewable — splittable into (a) backend schema + API + tests, (b) frontend port, (c) wiring. | Pass |
| IX — Test-First for Backend API (NON-NEGOTIABLE) | Every new backend endpoint gets a `[TF]` → `[IMPL]` cycle: archive post, unarchive post, archive series, unarchive series, templated series-create, series-delete guard, PATCH-post invariant with archive-exclusion + sequential-integrity. Six TF cycles total. The 002 tests that encode the superseded FR-005 / FR-005b clauses are **grandfathered-and-updated** — tests rewritten under IX to reflect the new behavior. | Pass |
| X — API Compatibility & UX Consistency | Shared 409 `platform_gap_conflict` body shape is preserved and reused on the new endpoints (FR-021). New 409 body `sequential_integrity_violation` is defined once and reused by create + update paths. `PostResponse` adds fields (additive, backwards-compatible). 002 callers see no breaking change except where the 003 supersedence explicitly relaxes a rule. | Pass |

**Result**: all ten principles pass. **4 constitution-level deviations** enumerated in Complexity Tracking (1 under Principle II, 3 under Principle I). **2 supersedences** of 002 clauses (FR-005, FR-005b) and **3 design choices** from Clarifications — all 9 items documented for the PR description per Principle V.

## Project Structure

### Documentation (this feature)

```text
specs/003-content-management/
├── plan.md                      # This file
├── research.md                  # Phase 0 decisions
├── data-model.md                # Schema additions + invariant pseudocode
├── high-level-design.md         # HLD with mermaid (current vs 003 upgrade)
├── quickstart.md                # Developer walkthrough for 003
├── contracts/
│   ├── series-api.md         # Series endpoints + archive/unarchive contract
│   ├── post-api.md           # Archive/unarchive post + updated PATCH rules
│   └── scheduling-invariant.md   # check_platform_gap + sequential-integrity
├── checklists/
│   └── requirements.md          # From /speckit-specify (all pass)
└── spec.md                      # With all 13 Clarifications
```

### Source Code (repository root)

```text
eng-hiring-take-home/
├── backend/
│   ├── app/
│   │   ├── core/
│   │   │   ├── database.py               # MODIFIED — idempotent ALTER adds 4 posts cols + 2 series cols
│   │   │   └── scheduling.py             # MODIFIED — exclude archived from gap; add check_sequential_integrity
│   │   ├── models/
│   │   │   ├── post.py                   # MODIFIED — add body, published_url, stage, previous_status
│   │   │   └── series.py                 # MODIFIED — add status, previous_status
│   │   ├── schemas/
│   │   │   ├── post.py                   # MODIFIED — PostCreate/Update gain body; PostResponse gains new read-only fields + derived author
│   │   │   └── series.py                 # MODIFIED — SeriesCreate is REPLACED with the 4-stage shape; new response + archive shapes
│   │   ├── api/
│   │   │   ├── auth.py                   # UNCHANGED (router content); prefix change handled in main.py
│   │   │   ├── posts.py                  # MODIFIED — invariant excludes archived; add archive + unarchive endpoints; DELETE guard for published; sequential-integrity re-check on PATCH for series posts
│   │   │   └── series.py                 # MODIFIED — create endpoint REWRITTEN to accept the 4-stage body; add archive + unarchive; DELETE guard rejects 204 when any post is published
│   │   └── main.py                       # MODIFIED — all three routers now mounted with prefix `/api/v1`
│   ├── scripts/
│   │   └── seed_data.py                  # MODIFIED — seed includes templated 4-stage series with body + stage; plus one archived example
│   └── tests/
│       ├── test_auth.py                  # MODIFIED — paths updated to `/api/v1/...`
│       ├── test_posts.py                 # MODIFIED — paths updated; archive/unarchive paths + DELETE guard + FR-005b removal
│       ├── test_scheduling.py            # MODIFIED — paths updated; archive exclusion + sequential-integrity cases
│       └── test_series.py                # MODIFIED — paths updated; create-body rewritten to 4-stage shape; archive + unarchive; DELETE guard coverage; FR-005b test removed
├── frontend/
│   ├── package.json                      # MODIFIED — add tailwindcss, postcss, autoprefixer (devDep) + lucide-react (dep)
│   ├── postcss.config.js                 # NEW — Tailwind pipeline
│   ├── tailwind.config.js                # NEW — content scope + theme extensions to match CCM
│   ├── src/
│   │   ├── index.css                     # MODIFIED — `@tailwind base/components/utilities` directives added
│   │   ├── App.jsx                       # MODIFIED — routes: `/login`, `/register`, `/` → Dashboard
│   │   ├── api/
│   │   │   └── client.js                 # MODIFIED — API_BASE now `http://localhost:8000/api/v1`; add seriesApi.create (new shape), archive, unarchive, include_archived param
│   │   ├── components/
│   │   │   ├── Layout.jsx                # REWRITTEN — ports CCM's TopNav + SubHeader pattern; single auth-gated shell
│   │   │   ├── ProtectedRoute.jsx        # UNCHANGED
│   │   │   ├── Primitives.jsx            # NEW (ported)
│   │   │   ├── ListView.jsx              # NEW (ported) — always shows archived with faded styling
│   │   │   ├── CalendarView.jsx          # NEW (ported) — wraps react-big-calendar, hides archived
│   │   │   ├── PostForm.jsx              # NEW (ported)
│   │   │   ├── SeriesBuilder.jsx         # NEW (ported) — 4-stage template + 15-min banner + client-side sequential-integrity precheck
│   │   │   ├── ConfirmModal.jsx          # NEW (ported)
│   │   │   ├── Toast.jsx                 # NEW (ported — lifted out of CCM app.jsx)
│   │   │   ├── Icon.jsx                  # NEW — thin wrapper over `lucide-react` preserving CCM's `<Icon name="...">` prop surface
│   │   │   └── utils.js                  # NEW — ported findConflicts helpers (mirrors backend/scheduling.py logic client-side)
│   │   └── pages/
│   │       ├── Login.jsx                 # UNCHANGED
│   │       ├── Register.jsx              # UNCHANGED
│   │       └── Dashboard.jsx             # NEW — top-level page wiring ListView + CalendarView + the modals
│   ├── src/api/client.test.js            # MODIFIED — paths updated; seriesApi + archive coverage (Vitest)
│   └── src/pages/                        # DELETED: PostsList.jsx, PostEdit.jsx, CalendarPage.jsx, SeriesList.jsx, SeriesEdit.jsx, SeriesDetail.jsx (and their tests if any)
└── readme.md                             # MODIFIED — short 003-upgrade section noting the port, new deps, /api/v1 path change
```

**Structure Decision**: **Option 2 — Web application** (matches the
repo). All ported CCM components sit at `frontend/src/components/`
alongside the existing `Layout.jsx` and `ProtectedRoute.jsx` — no
version-suffix subdirectory, no generation suffix on filenames. A single new
page `frontend/src/pages/Dashboard.jsx` replaces the six 002 pages.
Backend additions land in the existing files (idiomatic extension),
except `main.py` which re-bases the router prefix to `/api/v1` for
all three routers in one surgical change.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Frontend adds `tailwindcss`, `postcss`, `autoprefixer` as devDeps and `lucide-react` as a dep (Principle II). | The CCM reference implementation (source of truth per Clarify-Q6) is built entirely on Tailwind utility classes and lucide icons. Porting the components without Tailwind would mean rewriting every style rule as hand-authored CSS — a change that would take longer than the entire feature budget and lose design fidelity. lucide-react is the idiomatic React wrapper for lucide (the CCM's UMD version is unusable under Vite). | Hand-authored CSS: rejected — multi-day rewrite, drifts from CCM immediately. Copying compiled Tailwind CDN output into a single static stylesheet: rejected — would freeze the design and block iteration. Using a different icon set (e.g., Heroicons): rejected — every CCM component references specific lucide icon names; swap would require touching every component. |
| Router prefix rebased from `/api` (001/002) to `/api/v1` everywhere (Principle I — existing module contract rewrite). | User directive at `/speckit-plan` time: "API should be versioning, let's keep all API as v1". Consistency beats partial versioning; mixing `/api/posts` with `/api/v1/series` would create two naming conventions and confuse any future caller. The change is a single-line prefix edit in `main.py` + matching find-and-replace in the test suite + `frontend/src/api/client.js`'s `API_BASE`. | Dual-mount (`/api/...` legacy + `/api/v1/...` alias): rejected — doubles the test surface for every endpoint, more surface to maintain, against the constitution's "start simple" bias. Leaving 001/002 endpoints unversioned and only the new endpoints under a nested `/api/v1/series/v2` path: rejected — exactly the mixed-naming outcome the user's directive rules out. |
| `POST /api/v1/series` replaces rather than coexists with the 002 cadence-based body shape (Principle I — rewriting an existing endpoint signature). | Same "keep it all v1" directive + the 003-upgrade frontend is the only client that ever called the series-create endpoint; there is no external contract to preserve. Coexistence would require either two endpoints (failing the Q6 "frontend is source of truth" framing — the frontend only sends the 4-stage body) or a polymorphic request body (brittle and fails Pydantic's `Literal` validation approach). | Dual endpoints (`/series/cadence` + `/series/template`): rejected for the same reasons as dual-mount. Accepting either body shape on one endpoint: rejected — request-shape polymorphism undermines Principle VIII reviewability. |
| Six 002 page components are DELETED (Principle I — removing existing modules). | They are unreachable after the CCM port: `Dashboard.jsx` is the only page, and the 002 routes are dropped from `App.jsx`. Keeping dead code for a feature whose backend contract also changed would mislead reviewers and violate Principle VIII ("Dead code ... MUST NOT be committed"). Git history retains them for rollback. | Keeping as `.legacy` files: rejected — still shows up in lint, still imported by stale route definitions. Commenting out routes but keeping pages: rejected — same dead-code problem. |

**No other deviations.** Two 002 clauses (FR-005, FR-005b) are
**superseded**, not deviated from — see the Principle V evaluation
and the PR description plan.

---

## Phase 0 — Research (completed inline)

See [research.md](./research.md). 10 decisions recorded, zero open
questions. Highlights:

1. Per-view archive visibility via `?include_archived=bool` query
   parameter (Clarify-Q4 resolution).
2. Archive/unarchive state machine — previous_status round-trip.
3. Templated series-create request shape + atomic transaction.
4. Sequential-integrity check as pure function mirroring check_platform_gap.
5. Status enum migration — additive (SQLite stores as string; no
   enum-type change needed).
6. CCM-to-Vite port strategy — component-by-component rewrite, keep
   CCM's prop surface, inject via ES imports.
7. Tailwind config — match CCM's OKLCH palette + Inter font stack.
8. lucide-react icon mapping — keep `name` prop compatibility where
   feasible via a thin `<Icon name="...">` wrapper.
9. Legacy route policy — 002 pages stay in `frontend/src/pages/` but
   `App.jsx` routes them out; re-enable is one-line if rollback needed.
10. 002 test grandfather policy — only the two tests enforcing the
    superseded FR-005 / FR-005b clauses are rewritten; all others
    stay.

## Phase 1 — Design & Contracts (completed inline)

- [data-model.md](./data-model.md) — final DB schema deltas, Pydantic
  schema additions, `check_platform_gap` + `check_sequential_integrity`
  pseudocode, templated series-create bulk-write pseudocode, test matrix.
- [contracts/post-api.md](./contracts/post-api.md) — DELETE
  guard body, archive/unarchive endpoints, updated PATCH behavior.
- [contracts/series-api.md](./contracts/series-api.md) — templated
  create endpoint, archive/unarchive endpoints, updated DELETE guard,
  updated list endpoint with `include_archived`.
- [contracts/scheduling-invariant.md](./contracts/scheduling-invariant.md) —
  invariant + sequential-integrity contracts.
- [high-level-design.md](./high-level-design.md) — mermaid diagrams
  showing current (002) vs proposed (003) architecture, data model
  ER, and key sequences.
- [quickstart.md](./quickstart.md) — developer walk-through.

### Constitution re-check (post-design)

Re-verified against v1.2.0 after writing data-model.md + contracts +
HLD. No new violations. The Tailwind/lucide devDep additions remain
the only justified deviation. No new 002 clauses are superseded
beyond FR-005 + FR-005b already captured.

**Proceed to `/speckit-tasks`.**
