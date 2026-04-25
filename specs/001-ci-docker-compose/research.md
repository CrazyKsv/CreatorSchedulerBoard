# Phase 0 Research: CI & Local Docker Compose

**Feature**: `specs/001-ci-docker-compose`
**Date**: 2026-04-22

Every item below was a candidate `NEEDS CLARIFICATION` during planning. All are
resolved; the resulting decisions drive the concrete artifacts in Phase 1.

## 1. Frontend container mode: dev server vs. built preview

**Decision**: Run the **Vite dev server** (`npm run dev -- --host 0.0.0.0`)
inside the container with the host's `frontend/src/` and `frontend/public/`
directories bind-mounted.

**Rationale**:
- FR-006 requires that edits on the host are reflected without rebuilding the
  image. `vite dev` is the native mechanism; `vite preview` on a `vite build`
  artifact is static and defeats the requirement.
- `vite build` on every start would violate SC-002 (sub-60s restart).
- `--host 0.0.0.0` is required so the port forward from the host can reach the
  Vite server inside the container; default `localhost` bind refuses external
  connections.

**Alternatives considered**:
- *Build + nginx* — closer to prod, but no hot reload and adds nginx as a new
  surface area for a dev-only use case. Rejected.
- *Vite preview from a committed `dist/`* — defeats the live-reload requirement.
  Rejected.

## 2. Backend container mode: uvicorn --reload vs. plain uvicorn

**Decision**: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000` with
`backend/app/` bind-mounted read-write. Do not include `--workers N` (incompatible
with `--reload`).

**Rationale**:
- FR-006: backend edits must auto-reload. `--reload` is uvicorn's built-in
  mechanism and matches what `readme.md` already tells non-Docker developers to
  use.
- `--host 0.0.0.0` for the same container-port-binding reason as above.

**Alternatives considered**:
- *gunicorn with reload* — extra dependency for zero dev benefit. Rejected.
- *Production-style multi-worker* — breaks FR-006; the compose is explicitly
  dev-only. Rejected.

## 3. SQLite file path inside the container

**Decision**: Bind-mount the host directory `./backend` to `/app` inside the
backend container (with anonymous volumes masking `/app/.venv` and nested
`__pycache__` so Linux-container bytecode/wheels don't collide with the
host's). Keep the existing default
`DATABASE_URL=sqlite+aiosqlite:///./scheduler.db` from
`backend/app/core/config.py:9` unchanged — with CWD `/app` inside the
container, this resolves to `/app/scheduler.db`, which via the bind mount
**is** `backend/scheduler.db` on the host. No DATABASE_URL override in
compose is required; `.env.example` documents the value for completeness
but it matches the app default.

**Rationale**:
- `readme.md:94` already advertises `backend/scheduler.db` as the DB
  location for the non-Docker workflow. Making the compose workflow use
  the same file keeps the two workflows interoperable: a developer who
  seeded via `python backend/scripts/seed_data.py` in a venv and then
  switches to `docker compose up` sees the same data (and the seed-on-empty
  gate correctly fires no-op because `alice@example.com` already exists).
- Reusing the app's existing default URL means **no code change to
  `backend/app/core/**`** — this is the minimum-touch way to satisfy FR-002.
- Bind-mounting the whole `./backend` directory also covers source,
  scripts, tests, and `pytest.ini` in a single volume declaration, so
  hot-reload, ad-hoc `docker compose run backend pytest`, and seed
  invocations all Just Work.
- FR-002 is satisfied: `docker compose down` leaves `backend/scheduler.db`
  untouched on the host; restart recovers the same file.

**Alternatives considered**:
- *Named Docker volume at `/data` with
  `DATABASE_URL=sqlite+aiosqlite:////data/scheduler.db`* — originally
  selected for isolation, but flipped during the `/speckit-analyze`
  readme-consistency pass. The named volume hid the DB from the
  non-Docker workflow, which `readme.md` actively documents as
  `backend/scheduler.db`. Isolation is not a requirement for this feature;
  interoperability is. Rejected.
- *tmpfs volume* — would discard data on `down`, violating FR-002 and
  SC-003. Rejected.
- *Bind-mount only `./backend/scheduler.db`* — Docker refuses to bind
  a non-existent file on first start. Working around that with a `touch`
  in a pre-start script is uglier than just mounting the directory.
  Rejected.

**Risks accepted**:
- If a developer in the non-Docker workflow sets `DATABASE_URL` in
  `backend/.env` to a non-default path, the compose workflow (which
  does not override DATABASE_URL) will still use `./scheduler.db`. This
  is acceptable: it's the documented default; surprising divergence is
  covered by FR-008 (env-var documentation) and the updated readme.

## 4. Seed-on-empty mechanism

**Decision**: Add `backend/docker-entrypoint.sh`. On start, it checks whether
the seeded user exists using a one-line Python snippet against the sync SQLite
engine:

```sh
python -c "
import sqlite3, os, sys
# CWD is /app (the bind-mounted backend dir), so ./scheduler.db equals backend/scheduler.db on the host
p = os.environ.get('SEED_CHECK_DB', './scheduler.db')
if not os.path.exists(p):
    sys.exit(1)
c = sqlite3.connect(p)
try:
    r = c.execute(\"SELECT 1 FROM users WHERE email='alice@example.com' LIMIT 1\").fetchone()
    sys.exit(0 if r else 1)
except sqlite3.OperationalError:
    sys.exit(1)
"
```

If the check exits non-zero (DB missing, table missing, or no seeded user),
the script runs `python scripts/seed_data.py`. Either way it then
`exec`s uvicorn. The existing seed script runs `Base.metadata.create_all`
itself (see `backend/scripts/seed_data.py:40-41`), so the schema is created as
part of seeding when the DB is new.

**Rationale**:
- FR-003 forbids modifying `scripts/seed_data.py`. Gating at the entrypoint
  layer is the minimum-touch solution.
- Using the stdlib `sqlite3` module avoids importing the app's async stack
  inside the entrypoint and keeps the check fast and dependency-free.
- `exec uvicorn ...` (not `uvicorn ...`) ensures uvicorn becomes PID 1 so
  signals propagate correctly.

**Alternatives considered**:
- *Always run the seed script* — rejected in `/speckit-clarify` Q3; the seed
  script appends posts on every run.
- *Modify the seed script to be fully idempotent* — explicitly forbidden by
  FR-003.
- *Use a marker file like `/data/.seeded`* — fragile if a developer manually
  deletes rows; an actual existence check on `alice@example.com` is more
  truthful.

## 5. Hot reload reliability on non-Linux hosts

**Decision**: Leave the defaults. Do **not** enable polling (`CHOKIDAR_USEPOLLING`
or Vite's `usePolling`) unless reload proves unreliable on macOS/Windows during
local smoke testing.

**Rationale**:
- Docker Desktop on macOS/Windows uses gRPC FUSE / VirtioFS by default, which
  delivers inotify events to most common editors.
- Polling uses measurable CPU and is easy to enable later if needed. No reason
  to pay its cost preemptively.

**Fallback documented in `docs/ci.md`**: If a developer reports missed reloads
on macOS, set `CHOKIDAR_USEPOLLING=true` and Vite `server.watch.usePolling=true`
in `.env` / `vite.config.js`. This is documentation only; not shipped.

## 6. CORS origins when the frontend runs in a container

**Decision**: Leave `backend/app/main.py:23-28` CORS configuration untouched.
The frontend container still serves to the host at `http://localhost:5173`,
which is already in the allowlist. No code change.

**Rationale**:
- The frontend container publishes to the host on 5173; the developer's
  browser connects to `http://localhost:5173` (on the host), and requests to
  the backend go to `http://localhost:8000` (also host). Both are already
  allowed.
- The constitution's Principle I plus the "no edits to `backend/app/**`"
  self-imposed constraint make any CORS change a last resort.

**Alternatives considered**:
- *Add `http://frontend:5173`* — would only matter if a backend-to-frontend
  call existed; it doesn't. Rejected as unnecessary.

## 7. How the frontend container reaches the backend

**Decision**: Ship `VITE_API_URL=http://localhost:8000/api` as the default in
`.env.example` for Docker usage. The browser (which runs on the host) makes
the fetch; the frontend container itself does not call the backend.

**Rationale**:
- `frontend/src/api/client.js:1` reads `import.meta.env.VITE_API_URL` with a
  fallback of `http://localhost:8000/api`. The browser executes this code, so
  `localhost` refers to the **host**, not the container — the existing
  default already works.
- Shipping an explicit `.env.example` value documents this and gives
  developers one place to override.

**Alternatives considered**:
- *Use the compose network DNS name `http://backend:8000`* — would fail because
  the request is issued from the user's browser, not from inside the frontend
  container. Rejected.

## 8. Pinned tool versions for CI

**Decision**: Python **3.11** (CI + Docker image), Node **20** LTS (CI +
Docker image). The non-Docker venv workflow documented in `readme.md:20`
continues to support Python **3.9+**; 3.11 is a superset that satisfies
that floor, not a replacement.

**Rationale**:
- `readme.md:20` states "Requires Python 3.9+"; 3.11 is the newest version
  that keeps FastAPI/aiosqlite/SQLAlchemy wheels precompiled and free of
  known compat issues with the pinned dependency set.
- Node 20 is the current LTS and matches what Vite 7 + React 19 are routinely
  built against.
- Pinning is required by the constitution's preference for deterministic CI
  and by FR-014 (install from committed lockfiles on a clean env).
- The updated readme will preserve "Python 3.9+" for the venv workflow and
  add a sentence clarifying that CI and the Docker image run on 3.11 so a
  venv developer can reproduce CI exactly by using 3.11 locally if they
  choose.

**Alternatives considered**:
- *Matrix across 3.9/3.10/3.11* — spends SC-005's 5-minute budget on coverage
  we don't need for a take-home. Rejected.
- *Python 3.12/3.13* — some wheels for the pinned `bcrypt==4.0.1` are rockier;
  not worth the risk. Rejected.
- *Raise readme's floor to "3.11 required"* — would contradict readme's
  existing "3.9+" statement without a clear technical reason for the
  non-Docker workflow. Rejected; the superset framing is truthful and
  preserves existing documentation.

## 9. Dependency caching strategy

**Decision**: Use the built-in cache of `actions/setup-python@v5`
(`cache: pip`, `cache-dependency-path: backend/requirements.txt`) and
`actions/setup-node@v4` (`cache: npm`,
`cache-dependency-path: frontend/package-lock.json`).

**Rationale**:
- Supports FR-015 with no custom cache keys.
- Actions own invalidation on lockfile changes, which is exactly what we want.

**Alternatives considered**:
- *Manual `actions/cache@v4`* — more code, no upside for this repo size.
- *No caching* — violates SC-005's 5-minute budget on cold runs.

## 10. Fork-PR secret safety

**Decision**: The workflow uses only the default `GITHUB_TOKEN` (available to
forks with limited scope) and does **not** reference any repository secrets.
No mitigation code required.

**Rationale**:
- FR-016 is satisfied by simply not using any `secrets.*` in the workflow.
- Nothing in this feature needs a secret: no deploys, no image pushes, no
  external API calls.

**Alternatives considered**:
- *`pull_request_target` trigger* — would expose elevated token scope and
  violate FR-016. Explicitly rejected; we use the standard `pull_request`
  trigger.

## 11. docker-compose smoke-job scope

**Decision**: Run `docker compose build` only. Do **not** run
`docker compose up` or any service-started smoke test in CI.

**Rationale**:
- Q5 clarification chose native-runner execution for tests. A full compose-up
  in CI would spend ~60–90s on image assembly and a further ~20s on container
  startup, for a signal that's already partially covered by the test jobs.
- Compose-build alone catches the two realistic breakages: invalid Dockerfile
  and invalid compose file.

**Alternatives considered**:
- *`docker compose up -d` plus a curl healthcheck* — doubles CI time without
  catching a failure class the test jobs miss. Rejected (see clarification
  Q5 option C).

## 12. Concurrency / superseding CI runs

**Decision**: Include a GitHub Actions `concurrency` block keyed on
`${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`, so
rapid pushes to the same branch don't pile up runners.

**Rationale**:
- Cheap optimization, protects SC-005 on burst push scenarios, and avoids
  wasting the monthly Actions minutes budget a free GitHub account has.

**Alternatives considered**:
- *No concurrency control* — wastes minutes on outdated SHAs. Rejected.

## 13. Branch-protection admin-UI procedure

**Decision**: Document the exact click-path in `docs/ci.md`:

1. Repository → **Settings** → **Rules** → **Rulesets** → **New ruleset**.
2. Target branch: `main`.
3. Require status checks to pass before merging; add:
   `backend-tests`, `frontend-tests`, `frontend-lint`, `compose-build`.
4. Save.

Explicitly note that on a free-tier **private** repo this UI path is
unavailable — per FR-013a.

**Rationale**:
- Satisfies FR-013a's documentation requirement without the repo owner having
  to hunt GitHub docs.

**Alternatives considered**:
- *Commit a ruleset JSON file* — GitHub's Rulesets-as-code API is still
  beta-ish; out of scope for a 3h take-home.

## Open questions

**None.** All items flagged during planning were resolved by the above
decisions or by the earlier `/speckit-clarify` session log in
`spec.md`.
