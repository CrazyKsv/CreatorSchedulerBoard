# Implementation Plan: Content Series

**Branch**: `002-content-series` | **Date**: 2026-04-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-content-series/spec.md`

## Summary

Deliver the Content Series feature in three backend passes and one frontend
pass, against the constraints locked in during `/speckit-specify` and
`/speckit-clarify`:

1. **Scheduling invariant first** (`backend/app/core/scheduling.py` +
   enforcement wiring into `POST /api/posts` and `PATCH /api/posts/{id}`).
   This is Principle III's NON-NEGOTIABLE rule; everything else depends on it.
2. **Series domain** (new `series` table, two additive columns on `posts`,
   `POST/GET/PATCH/DELETE /api/series` with atomic bulk-materialization).
   Schema changes roll out via an idempotent `ALTER TABLE … ADD COLUMN` check
   in `init_db` (Clarifications Q2: option C) — reviewers do not reset.
3. **Frontend** (new `seriesApi` client, `/series`, `/series/new`,
   `/series/:id` routes, nav link, series badge on PostsList).
4. **Tests and docs** (extend pytest, add `test_scheduling.py` /
   `test_series.py`, update `readme.md`).

Scope locks from Clarifications:
- PATCH never mutates `series_id` / `series_position` (FR-005a).
- 15-min rule applies to **all** non-null `scheduled_at` posts regardless of
  `status` (FR-008 amendment).
- Atomic abort on series-create returns **the same 409 shape as single-post
  conflict**, first conflict only (FR-011 amendment).

## Technical Context

**Language/Version**: Python 3.11 (Docker image + CI), Node 20 LTS (Docker image + CI). Non-Docker Python 3.9+ still supported per readme.
**Primary Dependencies**: FastAPI, SQLAlchemy 2 async, aiosqlite, pydantic-settings, pydantic v2 (existing). React 19, Vite 7, React Router 7, Vitest (existing). **No new runtime deps.**
**Storage**: SQLite at `backend/scheduler.db` via host bind-mount (shared between venv + Docker workflows). Schema evolution via `Base.metadata.create_all` for new tables + a one-shot idempotent `ALTER TABLE` for new columns on `posts`.
**Testing**: pytest 8 with `asyncio_mode=auto` (existing); Vitest 2 + React Testing Library (existing).
**Target Platform**: Same as 001-docker-compose — dev workstation (macOS / Linux / Windows Docker) and `ubuntu-latest` GitHub-hosted runners.
**Project Type**: Web application (backend + frontend).
**Performance Goals**: SC-001 (series creation ≤ 60 s from form), SC-005 (CI ≤ 5 min). No new performance constraints.
**Constraints**: ~3-hour timebox; no edits under `frontend/src/pages/PostEdit.jsx` or other frontend single-post forms (FR-005a means the form stays unchanged); no new runtime dependencies; no background workers (Clarifications Q1: option A).
**Scale/Scope**: Per-owner small — max 20 posts per series, handful of series per user. No pagination required for v1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Evaluation | Status |
|---|---|---|
| I — Extend, Don't Rewrite | Additive only: new `series.py` model / schema / api module; `posts.py` model and schema gain two columns / fields; `posts.py` API gains invariant calls at create/update; `main.py` gains one `include_router` line; `database.py` gains ~10-line idempotent migration block. No rewrites of existing endpoints. Frontend adds new pages and routes; existing `PostEdit.jsx` and `PostsList.jsx` are minimally modified (PostsList gets a badge; PostEdit untouched per FR-005a). | Pass |
| II — Stay on the Existing Stack | FastAPI + SQLAlchemy + SQLite + aiosqlite unchanged. No Alembic (Clarifications Q2). No APScheduler / background workers (Clarifications Q1). No new pip or npm deps. | Pass |
| III — Enforce Scheduling Invariants (NON-NEGOTIABLE) | Phase 1 of implementation. Invariant codified in `backend/app/core/scheduling.py`, called from single-post create/update AND series-create. Tests cover within-window rejection, exact-boundary acceptance, different-platform same-time, self-exclusion on PATCH, and series atomic abort. | Pass |
| IV — Pragmatic Test Coverage | New tests proportional to risk: invariant gets dedicated `test_scheduling.py` tests; new `/api/series` endpoints each get ≥ 1 happy + 1 failure test in `test_series.py`. Existing tests continue to pass unchanged. No Vitest additions required for the new pages (keeping scope tight; existing vitest coverage of API client + AuthContext + ProtectedRoute remains green). | Pass |
| V — Clear Structure & Documented Tradeoffs | Every new file lives under its natural namespace (`app/models/series.py`, `app/api/series.py`, `src/pages/Series*.jsx`). PR description will capture the Clarifications Q1/Q2 + Clarify-Q1/Q2/Q3 decisions and the minimal-deviation stance on existing legacy lint. | Pass |
| VI — Surface and Resolve Spec Conflicts (NON-NEGOTIABLE at execution gates) | Pre-spec halt resolved Q1 (scheduler scope) and Q2 (migration strategy). `/speckit-clarify` halt resolved Clarify-Q1 (PATCH+series), Clarify-Q2 (status scope of invariant), Clarify-Q3 (error shape). All answers are in `spec.md` Clarifications + `questions/002-content-series-pre-spec-answers.md`. No unresolved conflicts known at this gate. | Pass |

**Result**: all six principles pass. No justified deviations required.
Complexity Tracking section is empty.

### Constitution v1.2.0 amendment (added mid-planning, 2026-04-22)

The constitution was amended to v1.2.0 between `/speckit-plan` (which
produced this file under v1.1.0) and `/speckit-tasks`. New principles
VII (User-Friendly UI), VIII (Code Quality), IX (Test-First Backend API
NON-NEGOTIABLE), and X (API Compatibility & UX Consistency) now apply.
Per the user's `Tasks-Q1` answer (recorded in
`questions/002-content-series-pre-spec-answers.md`), 002 **adopts** the
new Principle IX rather than invoking its grandfather clause. The
generated `tasks.md` orders every backend API task as
test-first → implementation → green. Principles VII/VIII/X were already
materially honored by the earlier plan + clarifications and need no
additional changes here; `tasks.md` includes a UI smoke checklist task
that explicitly verifies Principle VII.

## Project Structure

### Documentation (this feature)

```text
specs/002-content-series/
├── plan.md                     # This file
├── research.md                 # Phase 0 decisions
├── data-model.md               # Series entity + invariant pseudocode
├── high-level-design.md        # HLD with mermaid diagrams (current + proposed)
├── quickstart.md               # Developer walk-through
├── contracts/
│   ├── series-api.md           # /api/series endpoint contracts
│   └── scheduling-invariant.md # check_platform_gap contract
├── checklists/
│   └── requirements.md         # From /speckit-specify
└── spec.md                     # With Clarifications session log
```

### Source Code (repository root)

```text
eng-hiring-take-home/
├── backend/
│   ├── app/
│   │   ├── core/
│   │   │   ├── database.py             # MODIFIED — add idempotent ALTER in init_db (FR-016)
│   │   │   └── scheduling.py           # NEW — check_platform_gap (Principle III)
│   │   ├── models/
│   │   │   ├── post.py                 # MODIFIED — add series_id, series_position
│   │   │   ├── series.py               # NEW — Series model
│   │   │   └── user.py                 # MODIFIED — add series relationship
│   │   ├── schemas/
│   │   │   ├── post.py                 # MODIFIED — PostResponse gains series fields
│   │   │   └── series.py               # NEW — SeriesCreate / Update / Response
│   │   ├── api/
│   │   │   ├── posts.py                # MODIFIED — wire invariant check into create/update
│   │   │   └── series.py               # NEW — 5 endpoints + atomic bulk-create
│   │   └── main.py                     # MODIFIED — one include_router line
│   ├── scripts/
│   │   └── seed_data.py                # OPTIONAL — add a sample series per seeded user
│   └── tests/
│       ├── test_posts.py               # MODIFIED — add invariant cases on POST/PATCH
│       ├── test_scheduling.py          # NEW — focused unit tests for check_platform_gap
│       └── test_series.py              # NEW — end-to-end series endpoint tests
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js               # MODIFIED — add seriesApi alongside postsApi
│   │   ├── components/
│   │   │   └── Layout.jsx              # MODIFIED — add `Series` nav link
│   │   ├── pages/
│   │   │   ├── PostsList.jsx           # MODIFIED — series badge when post has series_id
│   │   │   ├── SeriesList.jsx          # NEW
│   │   │   ├── SeriesEdit.jsx          # NEW (create-only for v1)
│   │   │   └── SeriesDetail.jsx        # NEW
│   │   └── App.jsx                     # MODIFIED — add 3 new routes
│   └── eslint.config.js                # UNCHANGED (legacy warn-level rules stay)
└── readme.md                           # MODIFIED — add short "Content Series" section
```

**Structure Decision**: Option 2 — Web application, matching the repo's
existing layout. All new files land under their natural namespaces so a
reviewer can trace the feature end-to-end (Principle V): model → schema →
endpoint → client → page. No new top-level directories.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. No entries.

---

## Phase 0 — Research (completed inline)

See [research.md](./research.md) for the decision log. Major decisions
(all resolved during `/speckit-specify` and `/speckit-clarify`, no new
questions open):

- DB migration approach: idempotent ALTER on startup (Clarifications Q2).
- Scheduler scope: series-only, no background worker (Clarifications Q1).
- Status-agnostic invariant (Clarify-Q2), shared 409 shape (Clarify-Q3),
  immutable series membership via PATCH (Clarify-Q1).

## Phase 1 — Design & Contracts (completed inline)

- [data-model.md](./data-model.md) — Series entity, Post extensions, invariant pseudocode, cadence math.
- [contracts/series-api.md](./contracts/series-api.md) — the 5 series endpoints.
- [contracts/scheduling-invariant.md](./contracts/scheduling-invariant.md) — `check_platform_gap` signature, error shape.
- [high-level-design.md](./high-level-design.md) — HLD with mermaid diagrams (current architecture + proposed additions).
- [quickstart.md](./quickstart.md) — the developer-facing walk-through.

### Constitution re-check (post-design)

Re-verified after writing data-model.md, contracts, and HLD. No new
violations introduced:

- No new deps appeared in any artifact.
- No edits land in `frontend/src/pages/PostEdit.jsx`.
- Principle III enforcement path is now concrete and testable.
- Principle VI: no new unresolved conflicts detected during design.

**Proceed to `/speckit-tasks`.**
