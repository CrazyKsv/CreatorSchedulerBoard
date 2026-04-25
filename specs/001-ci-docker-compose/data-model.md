# Data Model: CI & Local Docker Compose

**Feature**: `specs/001-ci-docker-compose`
**Date**: 2026-04-22

This feature does not introduce or modify **domain** entities. The existing
`User` and `Post` models in `backend/app/models/` are untouched. The "data
model" for this infrastructure feature is the set of **configuration and
runtime entities** whose shape the implementation has to respect.

## Entity 1 — Local Stack

Represents the three-piece runtime constructed by `docker-compose.yml`.

| Attribute | Value | Source of truth |
|---|---|---|
| `backend.image_base` | `python:3.11-slim` | `backend/Dockerfile.dev` |
| `backend.port_host` | `8000` | `docker-compose.yml` |
| `backend.port_container` | `8000` | `backend/Dockerfile.dev` (uvicorn flag) |
| `backend.command` | `./docker-entrypoint.sh` | `backend/Dockerfile.dev` ENTRYPOINT |
| `backend.workdir_mount` | `./backend → /app (rw, host bind-mount)` — covers `app/`, `scripts/`, `tests/`, `pytest.ini`, `requirements.txt`, and the runtime DB file `scheduler.db` in a single mount | `docker-compose.yml` volumes |
| `backend.venv_mask` | Anonymous volume at `/app/.venv` to prevent a host venv from leaking into the Linux container | `docker-compose.yml` volumes |
| `backend.env_file` | `./backend/.env` (loaded via compose `env_file:`; copied from `backend/.env.example`) | `docker-compose.yml` service env_file |
| `frontend.image_base` | `node:20-alpine` | `frontend/Dockerfile.dev` |
| `frontend.port_host` | `5173` | `docker-compose.yml` |
| `frontend.port_container` | `5173` | `frontend/Dockerfile.dev` (vite flag) |
| `frontend.command` | `npm run dev -- --host 0.0.0.0` | `frontend/Dockerfile.dev` CMD |
| `frontend.source_mount` | `./frontend/src → /app/src (rw), ./frontend/public → /app/public (rw), ./frontend/vite.config.js → /app/vite.config.js (ro), ./frontend/eslint.config.js → /app/eslint.config.js (ro), ./frontend/index.html → /app/index.html (ro)` | `docker-compose.yml` volumes |
| `frontend.node_modules` | Anonymous volume at `/app/node_modules` to prevent host mask | `docker-compose.yml` volumes |
| `db` | SQLite file at `backend/scheduler.db` on the host (via `backend.workdir_mount`); **no separate service** | `backend` service |

**Lifecycle**:

- `docker compose up` → build images if missing → start `backend` and
  `frontend` in parallel → backend entrypoint runs seed-if-empty against
  `backend/scheduler.db` → uvicorn serves `0.0.0.0:8000` → vite serves
  `0.0.0.0:5173`.
- `docker compose down` → stop and remove containers. `backend/scheduler.db`
  persists on the host (per FR-002).
- **Reset procedure**: `docker compose down && rm -f backend/scheduler.db &&
  docker compose up`. Documented as the "reset" command in `readme.md` and
  `docs/ci.md`. (No `down -v` equivalent exists because the feature ships no
  named volumes; this was an intentional trade against readme alignment.)

## Entity 2 — Environment Configuration

Represents the parameter surface exposed via `.env.example` and consumed by
the compose stack. Every value has a documented local-dev default.

| Variable | Default (compose) | Consumer | Purpose |
|---|---|---|---|
| `SECRET_KEY` | `"dev-only-do-not-use-in-production"` | backend | JWT signing; marked clearly as dev-only |
| `DATABASE_URL` | `sqlite+aiosqlite:///./scheduler.db` (matches the app default in `backend/app/core/config.py:9`; compose does not override) | backend | Relative path; inside the container CWD is `/app`, so it resolves to the bind-mounted `backend/scheduler.db` on the host |
| `VITE_API_URL` | `http://localhost:8000/api` | frontend build/dev | Browser-side URL, not container-internal |
| `SEED_ON_EMPTY` | `"1"` | backend entrypoint | Set to `"0"` to skip seeding even when DB is empty |

`.env.example` lives at **`backend/.env.example`** (not repo root) so its
path matches `readme.md:114`. Compose loads `./backend/.env` via its
`env_file:` directive; the developer copies `backend/.env.example` →
`backend/.env` to override defaults. The backend's pydantic-settings loader
(`backend/app/core/config.py:14-17`) also resolves `.env` relative to its
CWD (`/app` inside the container = `./backend/` on the host), so the same
file is honored in both the Docker and the non-Docker workflows.

**Validation rules**:

- `DATABASE_URL` MUST start with `sqlite+aiosqlite:///`. The backend
  entrypoint SHOULD log a clear warning (FR-007) if the resolved path is
  not writable from the container (e.g., the bind mount is missing or
  read-only).
- `SECRET_KEY` MUST be overridable; `.env.example` labels the default with a
  visible "DEV ONLY" comment.

## Entity 3 — CI Pipeline Run

Represents one execution of `.github/workflows/ci.yml`.

**Triggers**:

- `pull_request` on any branch targeting `main`.
- `push` on `main`.

**Jobs** (all run in parallel on `ubuntu-latest`):

| Job ID (status name) | Inputs | Primary command | Blocks merge when required |
|---|---|---|---|
| `backend-tests` | `backend/requirements.txt`, `backend/` sources/tests | `pytest` (cwd `backend/`) | Yes |
| `frontend-tests` | `frontend/package-lock.json`, `frontend/` sources/tests | `npm run test` (cwd `frontend/`) | Yes |
| `frontend-lint` | same as frontend-tests | `npm run lint` (cwd `frontend/`) | Yes |
| `compose-build` | `docker-compose.yml`, both Dockerfiles, `.dockerignore` | `docker compose build` | Yes |

**Concurrency**:
- Key: `${{ github.workflow }}-${{ github.ref }}`
- `cancel-in-progress: true`

**Permissions**:
- `contents: read` only. No `secrets.*` referenced (FR-016).

## Entity 4 — Documentation Surface

| Artifact | Content obligation |
|---|---|
| `readme.md` (edit) | New "Run with Docker" section alongside the existing Quick start, documenting `docker compose up`, `docker compose down`, the reset recipe (`rm backend/scheduler.db` + `up`), `docker compose logs -f`, and the URLs. Must clearly state that `backend/.env` is the env file in both workflows and that `backend/scheduler.db` is the DB file in both workflows. Add the venv↔Docker Python version note (3.9+ venv / 3.11 pinned for Docker+CI). Add a CI status badge. |
| `docs/ci.md` (new) | Branch-protection/ruleset setup procedure (see `research.md` §13). Free-tier private-repo caveat per FR-013a. |
| `backend/.env.example` (new) | One line per variable from Entity 2 with inline comments explaining defaults. Path chosen to match `readme.md:114`. |

## Non-entities (explicitly out of scope)

- No new domain models.
- No schema migrations (the existing `Base.metadata.create_all` call in
  `backend/app/core/database.py:36-38` and `backend/scripts/seed_data.py:40-41`
  handles first-run schema creation).
- No new backend configuration classes; environment variables route through
  the existing `pydantic_settings.BaseSettings` at
  `backend/app/core/config.py:5-19`.
