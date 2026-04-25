# Quickstart: CI & Local Docker Compose

**Feature**: `specs/001-ci-docker-compose`
**Audience**: Developer who has just cloned the repository.

This is the concrete one-command onboarding flow Story 1 promises. When the
implementation lands, the contents of this file will be mirrored in
`readme.md` under a new "Run with Docker" section so this file can serve as
the planning-time source of truth.

## Prerequisites

- Docker Desktop (macOS/Windows) or Docker Engine ≥ 24 with the compose
  plugin (Linux).
- Ports `8000` and `5173` free on the host.
- Git.

Nothing else — no Python, no Node, no virtualenvs.

## Start the stack

```sh
git clone <repo-url>
cd <repo>
cp backend/.env.example backend/.env   # optional; defaults work out of the box
docker compose up                      # add -d to detach
```

The env file lives at **`backend/.env`** — the exact path the non-Docker
workflow in `readme.md` already documents. Both workflows read the same
file.

First start takes ~1–3 minutes (image pull + `pip install` + `npm ci`).
Second start is under 60 seconds (SC-002).

## Verify

1. Open `http://localhost:5173` — login page renders.
2. Log in as `alice@example.com` / `password123`.
3. Posts list is populated (seed data loaded automatically on first start).
4. Open `http://localhost:8000/docs` — FastAPI Swagger UI renders (FR-005).

If step 3 shows an empty list: the stack started against an existing
`backend/scheduler.db` that the seed gate recognized as already-seeded.
Use the reset procedure below to wipe and re-seed.

## Hot reload

- Edit `frontend/src/pages/PostsList.jsx` → browser re-renders on save.
- Edit `backend/app/api/posts.py` → uvicorn reloads; next API call hits the
  new code.

No rebuild, no restart.

## Stop / reset / logs

```sh
docker compose down                                       # stop, keep DB
docker compose down && rm -f backend/scheduler.db && \
  docker compose up                                       # full reset: wipes DB, re-seeds on next start
docker compose logs -f                                    # tail all services
docker compose logs -f backend                            # tail one
```

The DB file is `backend/scheduler.db` on the host — the same path the
non-Docker workflow uses. There is no `docker compose down -v` recipe
because the feature ships no named volumes; removing the host file is the
reset.

## Run tests inside containers (optional)

The CI pipeline runs tests natively on the runner (see
`contracts/ci-workflow.md`), not through compose. But if you want to reproduce
something in-container:

```sh
docker compose run --rm backend pytest
docker compose run --rm frontend npm run test
docker compose run --rm frontend npm run lint
```

## CI

Opening a PR to `main` kicks off four parallel jobs: `backend-tests`,
`frontend-tests`, `frontend-lint`, `compose-build`. Results post back to the
PR page.

If you own the repo and want merges blocked on green CI, follow the
`docs/ci.md` procedure to enable GitHub branch protection / rulesets.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `port is already allocated` | Local uvicorn or Vite process from the non-Docker workflow is still running | `lsof -i :8000` / `:5173`, kill the stray process |
| Browser login fails with CORS error | `VITE_API_URL` in `.env` points to a URL not in the backend's CORS allowlist | Leave default `http://localhost:8000/api` |
| Empty posts list after reset | `rm backend/scheduler.db` removed the DB; seeding only runs on a fresh DB | Expected — the next `docker compose up` re-seeds automatically |
| Frontend saves don't reload | macOS/Windows filesystem event loss | Set `CHOKIDAR_USEPOLLING=true` in `.env` and restart the frontend service |
| Backend saves don't reload | You edited a file outside `backend/app/` (e.g., `backend/scripts/`) | Only `backend/app/` is mounted rw for reload; restart the backend service to pick up script edits |

## What this quickstart does *not* cover

- Production deploys — out of scope.
- Running against Postgres — deferred (see Clarifications 2026-04-22).
- Enabling GitHub branch protection — see `docs/ci.md`.
