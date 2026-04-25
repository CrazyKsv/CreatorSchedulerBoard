# Contract: docker-compose services

**Artifact**: `docker-compose.yml` + `backend/Dockerfile.dev` +
`frontend/Dockerfile.dev` + `backend/docker-entrypoint.sh`

This document is the authoritative interface the implementation must honor.
Any deviation is a spec violation.

## Service `backend`

### Image / build

- `build.context`: `./backend`
- `build.dockerfile`: `Dockerfile.dev`
- Base image: `python:3.11-slim`
- Installs: `pip install --no-cache-dir -r requirements.txt`

### Ports

- Host `8000` → container `8000` (published on `127.0.0.1` to avoid LAN exposure).

### Environment file

- `env_file: ./backend/.env` — compose loads env values from this file if it
  exists. Its location matches `readme.md:114`. Template shipped as
  `backend/.env.example`.

### Environment variables (with compose defaults)

| Name | Default | Required? |
|---|---|---|
| `SECRET_KEY` | `dev-only-do-not-use-in-production` | no |
| `DATABASE_URL` | *(not overridden in compose)* — resolves to the app default `sqlite+aiosqlite:///./scheduler.db`, which with CWD `/app` maps to `backend/scheduler.db` on the host | no |
| `SEED_ON_EMPTY` | `1` | no |
| `PYTHONUNBUFFERED` | `1` | baked into image |

### Volumes

| Source | Target | Mode | Purpose |
|---|---|---|---|
| `./backend` | `/app` | rw | Host bind-mount covering app source (hot reload), scripts, tests, `pytest.ini`, `requirements.txt`, and the runtime DB file `scheduler.db` — the same `backend/` directory a non-Docker developer already works in per `readme.md` |
| *(anonymous)* | `/app/.venv` | rw | Mask host `.venv` (macOS/Windows wheels would break inside a Linux container) |
| *(anonymous)* | `/app/__pycache__` | rw | Mask any stale top-level `__pycache__` from host-side runs |

### Entrypoint contract

`backend/docker-entrypoint.sh`, summarised:

```sh
#!/bin/sh
set -e

if [ "${SEED_ON_EMPTY:-1}" = "1" ]; then
  python -c "<seed-check snippet from research.md §4>" || python scripts/seed_data.py
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Contractual obligations:
- MUST be executable (`chmod +x`) and use `#!/bin/sh` (no bashisms).
- MUST `exec` uvicorn so it becomes PID 1 and handles `SIGTERM` cleanly.
- MUST succeed without error when `./scheduler.db` (i.e.,
  `backend/scheduler.db` on the host) does not exist on first start.
- MUST be a no-op for seeding when `alice@example.com` already exists (FR-003).
- MUST respect `SEED_ON_EMPTY=0` by skipping the seed check entirely.

### Exposed behavior

- `GET http://localhost:8000/` returns the root JSON from
  `backend/app/main.py:34-36` once the container is ready.
- `GET http://localhost:8000/docs` renders FastAPI Swagger UI (FR-005).
- `GET http://localhost:8000/api/...` proxies to the existing routers.

## Service `frontend`

### Image / build

- `build.context`: `./frontend`
- `build.dockerfile`: `Dockerfile.dev`
- Base image: `node:20-alpine`
- Installs: `npm ci` (honors `package-lock.json` per FR-014).

### Ports

- Host `5173` → container `5173` (published on `127.0.0.1`).

### Environment variables (with compose defaults)

| Name | Default | Required? |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000/api` | no |

### Volumes

| Source | Target | Mode | Purpose |
|---|---|---|---|
| `./frontend/src` | `/app/src` | rw | Hot reload |
| `./frontend/public` | `/app/public` | rw | Static asset hot reload |
| `./frontend/index.html` | `/app/index.html` | ro | Entry HTML |
| `./frontend/vite.config.js` | `/app/vite.config.js` | ro | Vite config (restart required on change) |
| `./frontend/eslint.config.js` | `/app/eslint.config.js` | ro | Lint config |
| `./frontend/package.json` | `/app/package.json` | ro | Scripts/visibility |
| `./frontend/package-lock.json` | `/app/package-lock.json` | ro | Lockfile |
| *(anonymous)* | `/app/node_modules` | rw | **Prevents host mask**: without this, the host's (likely empty) bind-mount hides container `node_modules`. |

### Command contract

`CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`

## Networking

- Default bridge network named by compose (`<project>_default`).
- Services do **not** need to reach each other by DNS in this feature: the
  frontend's API call originates from the user's browser, so it targets
  `http://localhost:8000/api` (host-published). See `research.md` §6 and §7.

## Named volumes

**None.** This feature deliberately ships no named Docker volumes. Host bind
mounts handle persistence (DB) and anonymous volumes mask host dev artifacts
(`.venv`, `node_modules`). Rationale: alignment with `readme.md`'s
documented `backend/scheduler.db` location (see `research.md` §3).

## Top-level compose assertions (must hold)

1. `docker compose config` exits 0 (file parses cleanly; no unresolved vars).
2. `docker compose build` exits 0 on a runner with no cached layers.
3. `docker compose up` produces a browsable frontend at `http://localhost:5173`
   within SC-002's 60s window on a warm machine.
4. `docker compose down && docker compose up` preserves any data created
   through the UI (SC-003). Persistence is provided by the host file
   `backend/scheduler.db` surviving the container lifecycle.
5. After `docker compose down`, `backend/scheduler.db` is still present on
   the host. Resetting the DB means `rm -f backend/scheduler.db` explicitly.
