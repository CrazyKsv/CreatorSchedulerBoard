# Creator Scheduler — Engineering Take-Home

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

Requires **Python 3.9+**.

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
    api/          # client (auth + posts API) + client.test.js
    components/   # Layout, ProtectedRoute + ProtectedRoute.test.jsx
    context/      # AuthContext + AuthContext.test.jsx
    pages/        # Login, Register, PostsList, PostEdit, CalendarPage
```

## Tech stack

| Layer    | Stack                                                            |
| -------- | ---------------------------------------------------------------- |
| Backend  | FastAPI, SQLAlchemy 2 (async), SQLite, JWT (python-jose), bcrypt |
| Frontend | React 19, Vite 7, React Router 7, react-big-calendar, date-fns   |
| DB       | SQLite (single file, no extra setup)                             |

## Environment (optional)

- **Backend**: create `backend/.env` and set `SECRET_KEY` (and optionally `DATABASE_URL`).
- **Frontend**: set `VITE_API_URL` if the API is not at `http://localhost:8000/api`.
