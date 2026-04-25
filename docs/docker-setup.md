# Docker Compose Setup

## Prerequisites

- Docker Desktop (macOS / Windows) or Docker Engine + compose plugin (Linux).
- Ports `8000` and `5173` free on the host.

Verify:

```sh
docker compose version
```

## Start

From the repository root:

```sh
docker compose up
```

First start: 1–3 min. Second start: under 60 s. Add `-d` to detach.

Open:

- App: <http://localhost:5173> (seeded login: `alice@example.com` / `password123`)
- API docs: <http://localhost:8000/docs>

## Stop / reset

```sh
docker compose down                    # stop, keep DB
rm -f backend/scheduler.db             # wipe DB (next start re-seeds)
```

## Optional: override defaults

Only needed if you want to change `SECRET_KEY`, `DATABASE_URL`,
`SEED_ON_EMPTY`, or `VITE_API_URL`:

```sh
cp backend/.env.example backend/.env
# edit backend/.env
```

The same `backend/.env` file is read by both the Docker and the venv
workflows. The DB file `backend/scheduler.db` is shared across both too.

## Optional: edit `docker-compose.yml`

Most setups don't need this. Touch the compose file only for:

- **Port conflict**: change the left-hand side of `"127.0.0.1:8000:8000"` or `"127.0.0.1:5173:5173"`.
- **LAN access**: drop the `127.0.0.1:` prefix to publish on all interfaces.
- **Disable auto-seed**: set `SEED_ON_EMPTY: "0"` under the `backend.environment` block.

## Commands cheatsheet

| Task | Command |
| --- | --- |
| Tail logs | `docker compose logs -f` |
| Rebuild images | `docker compose build` |
| Shell into backend | `docker compose exec backend sh` |
| Run backend tests | `docker compose run --rm backend pytest` |
| Run frontend lint | `docker compose run --rm frontend npm run lint` |

## See also

- [`../readme.md`](../readme.md) — quick start (both workflows).
- [`ci.md`](./ci.md) — GitHub Actions.
- [`../docker-compose.yml`](../docker-compose.yml) — authoritative service definitions.
