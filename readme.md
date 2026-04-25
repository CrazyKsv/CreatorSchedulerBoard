# Creator Scheduler — Engineering Take-Home

<!-- Replace <owner>/<repo> with your fork's path. -->
![CI](https://github.com/CrazyKsv/eng-hiring-take-home/actions/workflows/ci.yml/badge.svg)

A **monorepo** starter for the product-engineering take-home: extend a working Creator Scheduler without rewriting it.

For the full assignment details and requirements, see [ASSIGNMENT.md](ASSIGNMENT.md).

You **must** create your own repository from this template before starting the assignment. Follow GitHub’s guide: [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).

## What’s in the repo

- **Backend**: FastAPI (Python), SQLite, JWT auth, CRUD posts (title, platform, scheduled_at, status).
- **Frontend**: React (Vite), login/register, list & edit posts, calendar view for scheduled events.
- **Seed script**: Adds random users and posts so candidates can see data immediately.
- **Unit tests**: Backend (pytest), frontend (Vitest + React Testing Library).

## Quick start

### 1. Backend

Requires **Python 3.9+** for the venv workflow. CI and the Docker image pin
**Python 3.11** as a superset; 3.9+ remains supported for non-Docker local
dev.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # or: .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: **http://localhost:8000/docs**

### 2. Seed the database (optional but recommended)

From repo root or from `backend/`:

```bash
python backend/scripts/seed_data.py
```

This creates 3 users and random posts. Log in with:

- **alice@example.com** / **password123**
- **bob@example.com** / **password123**
- **charlie@example.com** / **password123**

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App: **http://localhost:5173**

- Register a new account or use a seed user.
- **Posts**: list (with status/platform filters), create, edit.
- **Calendar**: view scheduled posts as events.

## Run with Docker (alternative to the venv workflow)

Prefer one command to start everything? The repo ships a compose stack that
runs the backend, the frontend, and the same SQLite DB used by the venv
workflow. Requires only Docker.

> Full step-by-step guide: [`docs/docker-setup.md`](docs/docker-setup.md).

```bash
cp backend/.env.example backend/.env    # optional; defaults work out of the box
docker compose up                       # add -d to run detached
```

First start: 1–3 minutes (image pulls + `pip install` + `npm ci`).
Second start: under 60 seconds.

Same URLs as the venv workflow:

- Frontend: **http://localhost:5173**
- Backend docs: **http://localhost:8000/docs**

Log in with the seeded `alice@example.com` / `password123` and you should see
a populated posts list on first start — the container entrypoint auto-seeds
when the DB is empty (when it already has data, the seed step is a no-op, so
restarts preserve your work).

### Shared state between the two workflows

Both the venv workflow and the Docker workflow read and write the **same
files on your host**:

| Artifact | Location (both workflows) |
| --- | --- |
| Env overrides | `backend/.env` (copy from `backend/.env.example`) |
| SQLite DB | `backend/scheduler.db` |

This means you can seed with `python backend/scripts/seed_data.py` in a
venv, then switch to `docker compose up` and see the same data (and
vice-versa). No migration or export step is needed.

### Common commands

```bash
docker compose down                                               # stop, keep DB
docker compose down && rm -f backend/scheduler.db && docker compose up   # full reset, re-seeds
docker compose logs -f                                            # tail all services
docker compose logs -f backend                                    # tail one
docker compose run --rm backend pytest                            # run backend tests in the container
```

### Hot reload

- Edit `frontend/src/**` → browser updates without refresh.
- Edit `backend/app/**` → uvicorn auto-reloads on the next request.

No rebuild required for either side.

## Content Series

Plan a sequence of posts on a shared cadence (e.g., launch teaser →
announcement → follow-up → reminder) instead of scheduling each post
individually.

The 15-minute same-platform scheduling rule is enforced on every write
path. A conflicting write returns a `409 platform_gap_conflict` with
the offending post id and the delta; series-create aborts atomically
with zero partial rows.

Full walkthrough: [`specs/002-content-series/quickstart.md`](specs/002-content-series/quickstart.md).

## Content Management (003 upgrade)

Iteration 003 ships a UX-first overhaul on top of 002. Highlights:

- **All HTTP endpoints are now versioned under `/api/v1`.** Front-end
  default is `http://localhost:8000/api/v1`; override with
  `VITE_API_URL`. 001/002 tests were rebased in the same PR.
- **Templated series create.** `POST /api/v1/series` accepts a fixed
  4-stage body (Teaser → Announcement → Follow-up → Reminder). Each
  stage owns its own `platform`, `title`, optional `body`, and
  `scheduled_at`. Stage labels are read-only; the scheduled times
  must be strictly monotonically increasing (Sequential Integrity,
  FR-020); same-platform siblings must respect the 15-min gap.
- **Archival lifecycle.** `POST /api/v1/posts/{id}/archive` +
  `/unarchive` and `POST /api/v1/series/{id}/archive` + `/unarchive`
  soft-delete with `previous_status` round-trip. `DELETE` on a
  published post returns `409 published_requires_archive`; `DELETE`
  on a series with any published post returns `409
  series_has_published_posts`.
- **Per-view archive visibility.** `GET /api/v1/posts` and
  `/series` accept `?include_archived=true|false`. Default: `false`.
  ListView sends `true`; CalendarView omits (defaults false).
- **Post body + derived author.** `body` column (≤ 5000 chars) is now
  accepted on create/update and included in the response. `author` is
  derived at serialization time from the authenticated owner's
  `full_name` (falls back to `email`).
- **Frontend.** Vite-native port of the CCM reference into
  `frontend/src/components/*` with Tailwind + lucide-react. A single
  `Dashboard.jsx` replaces the six 002 pages; list + calendar views
  are view-switchable from the top of the page. Confirmation modals,
  inline loading, empty states, and error-toast verbatim wire-up all
  run through `ConfirmModal` and `Toast`.
- **New frontend deps (justified Principle II deviation):**
  `tailwindcss`, `postcss`, `autoprefixer` (devDependencies),
  `lucide-react` (dependency).

Full walkthrough:
[`specs/003-content-management/quickstart.md`](specs/003-content-management/quickstart.md).

## Running tests

**Backend** (from `backend/`):

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt   # includes pytest, pytest-asyncio, httpx
pytest
```

Tests use an in-memory SQLite DB (no file DB required). They cover auth (register, login, duplicate email, wrong password) and posts (list, create, get, update, delete, auth required, filters).

**Frontend** (from `frontend/`):

```bash
cd frontend
npm install
npm run test
```

Runs Vitest once. Use `npm run test:watch` for watch mode. Tests cover the API client, `AuthContext`, and `ProtectedRoute`.

## Project layout

```
backend/
  app/
    api/          # auth, posts endpoints
    core/         # config, db, security (JWT, bcrypt)
    models/       # User, Post (SQLAlchemy)
    schemas/      # Pydantic request/response
  scripts/
    seed_data.py  # random users + posts
  scheduler.db   # SQLite (created on first run / seed)

frontend/
  src/
    api/          # client (auth + posts + series API) + client.test.js
    components/   # Layout, ProtectedRoute, Dashboard primitives
                  # (Icon, Toast, ConfirmModal, PostForm, SeriesBuilder,
                  #  ListView, CalendarView, utils.js)
    context/      # AuthContext + AuthContext.test.jsx
    pages/        # Login, Register, Dashboard
```

## Tech stack

| Layer    | Stack                                                            |
| -------- | ---------------------------------------------------------------- |
| Backend  | FastAPI, SQLAlchemy 2 (async), SQLite, JWT (python-jose), bcrypt |
| Frontend | React 19, Vite 7, React Router 7, react-big-calendar, date-fns   |
| DB       | SQLite (single file, no extra setup)                             |
| DevOps   | Docker Compose (local dev), GitHub Actions (CI)                  |

## Environment (optional)

- **Backend**: create `backend/.env` (copy from `backend/.env.example`) and set `SECRET_KEY` (and optionally `DATABASE_URL`). The same file is consumed by both the venv workflow and the Docker Compose workflow.
- **Frontend**: set `VITE_API_URL` if the API is not at `http://localhost:8000/api/v1`.

## Continuous Integration

Every pull request to `main` runs four parallel jobs on GitHub Actions:
`backend-tests` (pytest), `frontend-tests` (Vitest), `frontend-lint`
(ESLint), and `compose-build` (`docker compose build` smoke). Workflow
file: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Details
including the local-reproduction commands and branch-protection setup
are in [`docs/ci.md`](docs/ci.md).
