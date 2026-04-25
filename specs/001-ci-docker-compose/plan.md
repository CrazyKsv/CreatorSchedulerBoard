# Implementation Plan: CI & Local Docker Compose

**Branch**: `001-docker-compose` | **Date**: 2026-04-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-ci-docker-compose/spec.md`

## Summary

Deliver two tightly-scoped infrastructure changes without touching application
code:

1. **Local Docker Compose stack** — a root `docker-compose.yml` plus two
   Dockerfiles (`backend/Dockerfile.dev`, `frontend/Dockerfile.dev`) that start
   the existing FastAPI app and the existing Vite-based React app with hot
   reload on both sides. SQLite `scheduler.db` lives at
   `backend/scheduler.db` on the host, reached by bind-mounting the
   `./backend` directory into the backend container — the same path
   `readme.md` already documents. On backend start, a short entrypoint seeds
   the DB **only if `alice@example.com` is missing**, so restarts are no-ops.

2. **GitHub Actions CI pipeline** — a single `.github/workflows/ci.yml` with
   four independent parallel jobs running natively on `ubuntu-latest`:
   `backend-tests` (pytest on a pinned Python with pip cache), `frontend-tests`
   (Vitest on a pinned Node with npm cache), `frontend-lint` (ESLint via the
   existing `npm run lint`), `compose-build` (`docker compose build` only, no
   services started). Each publishes a distinct job status so the repo owner
   can mark them as required checks in branch-protection — that admin-UI step
   is out of scope and is documented in a short `docs/ci.md`.

The plan respects the constitution: no changes to backend/frontend source, no
new application dependencies, SQLite retained (Principle II), scheduling
invariants untouched (Principle III), existing tests remain green
(Principle IV).

## Technical Context

**Language/Version**: Python 3.11 in the backend Docker image and in CI
  (pinned). The non-Docker workflow documented in `readme.md:20` continues
  to support Python 3.9+; 3.11 is offered as a superset that matches the
  CI/Docker baseline, not a replacement. Node 20 LTS is pinned in both the
  frontend Docker image and in CI.
**Primary Dependencies**: FastAPI, SQLAlchemy 2 async, aiosqlite (existing).
  React 19, Vite 7, Vitest 2, ESLint 9 (existing). No new runtime deps.
**Storage**: SQLite file at `backend/scheduler.db` on the host, reached via
  a bind-mount of `./backend` → `/app` in the backend container. The
  existing `backend/app/core/config.py:9` default
  (`sqlite+aiosqlite:///./scheduler.db`) is used as-is — no path override is
  needed. CI tests continue to use in-memory SQLite via the existing
  `backend/tests/conftest.py`.
**Testing**: pytest 8 (`asyncio_mode=auto`, `tests/`), Vitest 2
  (jsdom env, existing setup).
**Target Platform**: Developer workstation with Docker Desktop / Engine (macOS,
  Linux, Windows) for local; `ubuntu-latest` GitHub-hosted runner for CI.
**Project Type**: Web application (backend + frontend) — confirmed by the
  existing `backend/` and `frontend/` directories.
**Performance Goals**: Local second-start < 60s (SC-002); CI total wall-clock
  < 5 min on warm caches (SC-005).
**Constraints**: ~3h implementation budget; no new runtime dependencies;
  no modification to `backend/scripts/seed_data.py`; no touching of
  `backend/app/**` or `frontend/src/**`.
**Scale/Scope**: Single-developer local workstation + one CI pipeline. No
  multi-env, no staging, no container registry publish.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Evaluation | Status |
|---|---|---|
| I — Extend, Don't Rewrite | Feature adds infrastructure artifacts only (`docker-compose.yml`, `backend/Dockerfile.dev`, `frontend/Dockerfile.dev`, `.github/workflows/ci.yml`, `docs/ci.md`, a short README section). No files under `backend/app/**` or `frontend/src/**` are edited. | Pass |
| II — Stay on the Existing Stack | SQLite retained (Clarifications 2026-04-22). No new Python runtime deps. No new frontend deps. Docker is dev tooling, not an application runtime dependency. Backend Python lint (FR-012c) is **deferred** rather than introducing Ruff/Black config — deviation documented in PR. | Pass (deviation on FR-012c justified) |
| III — Enforce Scheduling Invariants | Feature does not add or alter any scheduling write path. Existing tests covering the 15-min same-platform rule continue to run in CI (once the Series feature lands; today they cover the existing post endpoints). | Pass (neutral) |
| IV — Pragmatic Test Coverage | No new production code ⇒ no new unit tests required. CI executes the existing pytest and Vitest suites plus ESLint. Compose-build job acts as a smoke test for Dockerfile/compose correctness. | Pass |
| V — Clear Structure & Documented Tradeoffs | All new files live at intuitive top-level locations. PR description will capture: SQLite retention rationale, backend-lint deferral, branch-protection admin-UI caveat, hot-reload vs built-image choice. | Pass |

**Result**: All gates pass; one minor deviation (backend Python lint deferred)
is justified in Complexity Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/001-ci-docker-compose/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (config entities, not domain data)
├── quickstart.md        # Phase 1 output (developer-facing start guide)
├── contracts/
│   ├── compose-services.md   # Service contracts: ports, env vars, volumes
│   └── ci-workflow.md        # Job contracts: triggers, inputs, status names
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── spec.md              # From /speckit-specify
```

### Source Code (repository root)

```text
eng-hiring-take-home/
├── .github/
│   └── workflows/
│       └── ci.yml                  # NEW — four parallel jobs
├── backend/
│   ├── Dockerfile.dev              # NEW — python:3.11-slim + pip install + uvicorn --reload
│   ├── docker-entrypoint.sh        # NEW — seed-if-empty, then exec uvicorn
│   ├── app/                        # UNCHANGED
│   ├── scripts/seed_data.py        # UNCHANGED (no edits per FR-003)
│   ├── tests/                      # UNCHANGED
│   ├── pytest.ini                  # UNCHANGED
│   └── requirements.txt            # UNCHANGED
├── frontend/
│   ├── Dockerfile.dev              # NEW — node:20-alpine + npm ci + vite dev
│   ├── src/                        # UNCHANGED
│   ├── package.json                # UNCHANGED
│   ├── vite.config.js              # UNCHANGED
│   └── eslint.config.js            # UNCHANGED
├── docker-compose.yml              # NEW — two services, bind-mounted host paths (no named volumes)
├── .dockerignore                   # NEW — excludes node_modules, .venv, .db files from build context
├── backend/.env.example            # NEW — env defaults at the path readme.md already documents
├── docs/
│   └── ci.md                       # NEW — branch-protection setup procedure
├── readme.md                       # MODIFIED — add "Run with Docker" section + CI badge
└── .gitignore                      # MODIFIED — add .env
```

**Structure Decision**: **Option 2 — Web application** (already matches the
repo). New infrastructure artifacts live at the repository root
(`docker-compose.yml`, `.dockerignore`) and inside each service directory
(`backend/Dockerfile.dev`, `backend/docker-entrypoint.sh`,
`backend/.env.example`, `frontend/Dockerfile.dev`). `.env.example` lives at
`backend/.env.example` specifically — not at the repo root — so the file
path matches `readme.md:114` and compose's `env_file: ./backend/.env`
directive loads it without further configuration. CI lives under the
standard `.github/workflows/ci.yml` path. Documentation additions go in
`docs/ci.md` plus a new section in the existing top-level `readme.md` — no
duplicate runbooks.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Backend Python lint is deferred (FR-012c) rather than adding Ruff/Black/Flake8 | Adding a Python linter would require committing new config and a dev dependency, both of which Principle II discourages within a 3h timebox. | Introducing Ruff now expands the diff, risks surfacing a long tail of style issues in existing code, and is not load-bearing for the feature's success criteria. The deferral is one line in the PR description. |

No other violations. No extra projects, no new abstractions.

---

## Phase 0 — Research (completed inline)

See [research.md](./research.md) for the full decision log. Every
`NEEDS CLARIFICATION` identified during planning was resolved without
ambiguity; no open questions remain.

## Phase 1 — Design & Contracts (completed inline)

- [data-model.md](./data-model.md) — configuration/runtime entities for this
  infra feature (no domain schema changes).
- [contracts/compose-services.md](./contracts/compose-services.md) — service
  contract: ports, env vars, volumes, healthcheck/lifecycle.
- [contracts/ci-workflow.md](./contracts/ci-workflow.md) — workflow contract:
  triggers, per-job inputs, concurrency behavior, required-status names.
- [quickstart.md](./quickstart.md) — the single-command onboarding flow
  Story 1 promises.

### Constitution re-check (post-design)

Revisited after Phase 1. No new violations introduced by the concrete design.
FR-012c still deferred (documented above). Local compose stack does not
expose secrets to the network (SECRET_KEY default is clearly marked
"development only" in `.env.example`). No changes that would weaken
Principle III — CI runs the existing scheduling tests unchanged.

**Proceed to `/speckit-tasks`.**
