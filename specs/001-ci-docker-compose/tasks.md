---
description: "Task list for CI & Local Docker Compose feature"
---

# Tasks: CI & Local Docker Compose

**Input**: Design documents from `specs/001-ci-docker-compose/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/compose-services.md`, `contracts/ci-workflow.md`, `quickstart.md`

**Tests**: No net-new test tasks. The feature relies on the existing `pytest`
and `vitest` suites (constitution Principle IV — pragmatic test coverage; no
new production code means no new unit tests required). Verification is
covered by acceptance smoke tasks per story.

**Organization**: Tasks are grouped by user story so each story can be
implemented and validated independently. US1 and US2 are both P1 but are
independent; US1 is the natural MVP because it delivers standalone
onboarding value with nothing from US2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1 = local compose, US2 = CI, US3 = parity/docs)
- File paths are absolute-from-repo-root

## Path Conventions

- **Web application** (matches repo): `backend/`, `frontend/`, `.github/workflows/`, `docs/` at the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tiny prep shared by both compose (local) and compose-build (CI).

- [X] T001 Update `.gitignore` at repo root to ensure `backend/.env` is ignored. The current `.gitignore` already covers `backend/*.db` and `backend/.env`, but add a trailing-newline and a short comment grouping dev-local files (`backend/.env`, `backend/scheduler.db`) so it is obvious they are intentionally untracked.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Artifacts that US1 (`docker compose up`) and US2 (`docker compose build` CI job) both depend on.

**CRITICAL**: No US1 or US2 work can begin until this phase is complete.

- [X] T002 Create `.dockerignore` at repo root. MUST exclude: `.git`, `.github`, `**/node_modules`, `**/.venv`, `**/__pycache__`, `**/*.db`, `**/.pytest_cache`, `**/dist`, `**/.DS_Store`, `specs/`, `.specify/`, `docs/`, `*.md`. Rationale: keeps the Docker build context small and deterministic for both local `docker compose build` and the CI `compose-build` job (FR-012b). Contract: the final build contexts for `./backend` and `./frontend` each fit under ~5 MB.

**Checkpoint**: `.dockerignore` exists. US1 and US2 may proceed in parallel.

---

## Phase 3: User Story 1 - One-command local environment (Priority: P1) 🎯 MVP

**Goal**: `docker compose up` from a fresh clone starts a working, seeded,
hot-reloading stack reachable at `http://localhost:5173` and
`http://localhost:8000/docs`.

**Independent Test**: Execute the `specs/001-ci-docker-compose/quickstart.md`
"Verify" section — login as `alice@example.com` / `password123`, see a
populated posts list, open the FastAPI docs page. Edit a file in
`backend/app/` and confirm auto-reload; edit a file in `frontend/src/` and
confirm HMR. `docker compose down && docker compose up` preserves data.

### Implementation for User Story 1

- [X] T003 [P] [US1] Create `backend/.env.example` containing: `SECRET_KEY=dev-only-do-not-use-in-production`, `DATABASE_URL=sqlite+aiosqlite:///./scheduler.db` (commented as "matches app default; compose does not override"), `SEED_ON_EMPTY=1`. Header comment must note the file is loaded by both the non-Docker venv workflow (per `readme.md:114`) and the Docker workflow (via compose `env_file: ./backend/.env`).

- [X] T004 [P] [US1] Create `backend/Dockerfile.dev`. Base: `python:3.11-slim`. Steps: set `WORKDIR /app`, `ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1`, `COPY requirements.txt .`, `RUN pip install -r requirements.txt`, `COPY . .`, `RUN chmod +x docker-entrypoint.sh`, `ENTRYPOINT ["./docker-entrypoint.sh"]`. No `CMD` (entrypoint `exec`s uvicorn). Exposes port 8000 (informational). Contract in `contracts/compose-services.md` (service `backend`) governs this file.

- [X] T005 [P] [US1] Create `backend/docker-entrypoint.sh`. `#!/bin/sh`, `set -e`. Seed-gate exactly as specified in `research.md` §4 — use stdlib `sqlite3` to check `SELECT 1 FROM users WHERE email='alice@example.com' LIMIT 1` against `./scheduler.db`; on any failure (missing file, missing table, no row), run `python scripts/seed_data.py`. Respect `SEED_ON_EMPTY=0` by skipping the check. Final line: `exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`. Commit mode `0755` so the container can execute it.

- [X] T006 [P] [US1] Create `frontend/Dockerfile.dev`. Base: `node:20-alpine`. Steps: `WORKDIR /app`, `COPY package.json package-lock.json ./`, `RUN npm ci`, `COPY . .`, `EXPOSE 5173`, `CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`. Contract in `contracts/compose-services.md` (service `frontend`) governs this file. `--host 0.0.0.0` is required so the host-published port reaches the Vite server.

- [X] T007 [US1] Create `docker-compose.yml` at repo root. Two services (`backend`, `frontend`), both `restart: unless-stopped`. Ports published on `127.0.0.1` only. `backend`: `build: { context: ./backend, dockerfile: Dockerfile.dev }`, `env_file: ./backend/.env` (optional — compose must not error if missing), explicit env defaults for `SECRET_KEY` and `SEED_ON_EMPTY`, ports `"127.0.0.1:8000:8000"`, volumes `./backend:/app`, anonymous volume `/app/.venv`, anonymous volume `/app/__pycache__`. `frontend`: `build: { context: ./frontend, dockerfile: Dockerfile.dev }`, env default `VITE_API_URL=http://localhost:8000/api`, ports `"127.0.0.1:5173:5173"`, granular source mounts per `contracts/compose-services.md` (service `frontend` volumes table), anonymous volume `/app/node_modules`. **No named volumes**. No `depends_on`. Depends on T002, T003, T004, T005, T006.

- [X] T008 [US1] Execute the full US1 acceptance run per `specs/001-ci-docker-compose/quickstart.md`. Fresh clone semantics: `docker compose down && rm -f backend/scheduler.db && docker compose up`. Verify: (a) frontend reachable at `http://localhost:5173`, (b) login with `alice@example.com`/`password123` succeeds, (c) posts list is populated, (d) `http://localhost:8000/docs` renders, (e) edit `backend/app/api/posts.py` (trivial whitespace) → uvicorn reloads in logs, (f) edit `frontend/src/pages/PostsList.jsx` → browser updates without refresh, (g) create one post through the UI, `docker compose down && docker compose up`, the post survives (SC-003). Record results inline as a PR-ready note.

**Checkpoint**: US1 is fully functional and demonstrable with no CI involvement.

---

## Phase 4: User Story 2 - Automated quality gate (Priority: P1)

**Goal**: Every PR to `main` and every push to `main` runs four parallel
jobs (`backend-tests`, `frontend-tests`, `frontend-lint`, `compose-build`)
on `ubuntu-latest`, each publishing a distinct status that the repo owner
can mark as required for merge.

**Independent Test**: On a branch, intentionally break a backend test
(e.g., change an expected status code in `backend/tests/test_posts.py`),
push, open a PR to `main`. Verify all four jobs run, `backend-tests` reports
failure visibly on the PR, the other three pass. Push a fix; verify CI
turns green.

### Implementation for User Story 2

- [X] T009 [P] [US2] Create `.github/workflows/ci.yml` exactly matching the contract in `specs/001-ci-docker-compose/contracts/ci-workflow.md`. Triggers: `pull_request` on branches `[main]` and `push` on branches `[main]`. Concurrency: `group: ci-${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`. Permissions: `contents: read` only, no `secrets.*` anywhere. Four jobs, all `runs-on: ubuntu-latest`, no `needs:`: `backend-tests` (setup-python@v5 with `python-version: "3.11"`, `cache: pip`, `cache-dependency-path: backend/requirements.txt`; `cd backend && pip install -r requirements.txt && pytest`); `frontend-tests` (setup-node@v4 with `node-version: "20"`, `cache: npm`, `cache-dependency-path: frontend/package-lock.json`; `cd frontend && npm ci && npm run test`); `frontend-lint` (same Node setup; `cd frontend && npm ci && npm run lint`); `compose-build` (setup-buildx-action@v3, `docker compose build`). Verify `actions/checkout@v4` is the first step of every job.

- [X] T010 [P] [US2] Create `docs/ci.md`. Sections: (1) "What CI does" — short list of the four jobs and what they catch. (2) "Enabling merge-blocking (repo owner action)" — the exact GitHub click-path from `research.md` §13 (Settings → Rules → Rulesets → New ruleset → branch `main` → require status checks → add `backend-tests`, `frontend-tests`, `frontend-lint`, `compose-build`). (3) Explicit note that on a free-tier **private** repository this path is unavailable and merge-blocking degrades to status-reporting only (FR-013a). (4) "Reproducing CI locally" — the exact same commands CI uses, quoted verbatim, satisfying the US3 parity contract.

- [ ] T011 [US2] **MANUAL** — requires GitHub push access from the user's machine. Push branch `001-docker-compose` and open a PR to `main`. Verify all four jobs trigger, each publishes a distinctly-named status (`backend-tests`, `frontend-tests`, `frontend-lint`, `compose-build`), and the pipeline is green. Then deliberately break one test (e.g., flip an `assert` in `backend/tests/test_auth.py`), push, verify CI turns red with exactly one failing job and three green; restore the test, verify green. Attach a link to one red and one green run in the PR description. Local validation already completed: YAML parses, all four command strings match the parity contract, `docker compose build` succeeds, the backend and frontend test suites run green inside the compose stack (see T008 smoke notes).

**Checkpoint**: US2 works end-to-end. US1 and US2 are both independently demonstrable.

---

## Phase 5: User Story 3 - Parity & discoverability (Priority: P2)

**Goal**: The top-level `readme.md` points to both workflows within a
minute of opening the repo, disambiguates the shared paths (`backend/.env`,
`backend/scheduler.db`) between the two workflows, and calls out the
Python version split (3.9+ venv / 3.11 Docker+CI) honestly. A developer
can reproduce any CI failure locally by copy-pasting documented commands.

**Independent Test**: Open `readme.md` cold; within ~60 seconds locate
(1) the "Run with Docker" section, (2) the CI status badge, (3) where
`.env` and `scheduler.db` live in each workflow. Copy the documented test
commands, run them locally against the same commit as a red CI run, and
observe matching failures.

### Implementation for User Story 3

- [X] T012 [US3] Edit `readme.md` to add a "Run with Docker" section after the existing "Quick start" section. Content: the one-command flow from `specs/001-ci-docker-compose/quickstart.md` (clone → `cp backend/.env.example backend/.env` → `docker compose up`), the verify bullets, the stop/reset/logs commands (including the reset recipe `docker compose down && rm -f backend/scheduler.db && docker compose up`), and the troubleshooting table. Must explicitly state: **both workflows read `backend/.env`** and **both workflows use `backend/scheduler.db`** (no duplicate DB locations).

- [X] T013 [US3] Edit `readme.md` Quick start section: keep "Requires Python 3.9+" for the venv workflow, add one sentence: "CI and the Docker image pin Python 3.11; 3.9+ remains supported for non-Docker local dev." Edit the Tech stack table to add a "DevOps" row: "Docker Compose (local dev), GitHub Actions (CI)". At the very top of `readme.md`, insert a CI status badge in the form `![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)` — use `<owner>/<repo>` as a literal template and add one line of inline comment or HTML comment explaining that the owner must substitute their fork's path.

- [X] T014 [US3] Verify CI↔local parity per FR-018: from the repo root, run `cd backend && pytest` (expect green), `cd frontend && npm run test` (expect green), `cd frontend && npm run lint` (expect green), `docker compose build` (expect green). Confirm all four commands are the exact strings executed by `.github/workflows/ci.yml`. If any differ even in whitespace/flags, update the workflow to match the local command (not the other way around).

**Checkpoint**: All three stories are independently functional. `readme.md` FR-019 discoverability is met.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: PR hygiene and constitution-mandated disclosures.

- [X] T015 [P] Run the **full** existing test suites one more time on `main`'s tip after merging the branch locally: `cd backend && pytest` and `cd frontend && npm run test && npm run lint`. Confirm all pre-existing tests still pass (constitution Principle IV — "existing passing tests MUST continue to pass").

- [X] T016 [P] Confirm no files under `backend/app/**`, `frontend/src/**`, or `backend/scripts/seed_data.py` were modified by this feature (constitution Principle I; FR-003). Command: `git diff main -- backend/app frontend/src backend/scripts/seed_data.py` MUST print nothing.

- [X] T017 Update `backend/app/core/database.py` ONLY if the unused imports `from dataclasses import asdict` and `from platform import java_ver` on lines 1-2 are producing lint or CI warnings that would fail the new CI. If they are not causing failures, **do not touch them** (constitution Principle I — "Renaming, relocating, or rewriting existing modules is disallowed unless required to ... eliminate a genuine blocker"). Record decision in PR description.

- [X] T018 Write the PR description. Draft at `specs/001-ci-docker-compose/PR_DESCRIPTION.md` — paste into the GitHub PR body after pushing, then fill in the two TODO links (Loom, one-red/one-green CI run). MUST include the five elements from constitution Principle V: (a) approach — what was built and why (SQLite kept, host bind-mount for readme alignment, native CI, four parallel jobs); (b) assumptions — values from `spec.md` Assumptions block; (c) tradeoffs — SQLite vs Postgres (migration is the follow-up), named volume vs host bind-mount (picked bind-mount for readme alignment, accepted risk that a stale host `.venv` must be masked), native CI vs compose-based CI (picked native for speed, parity kept at command level), backend Python lint deferred (FR-012c — no committed Ruff config), compose build-only vs full stack in CI (picked build-only for SC-005 budget); (d) what you would improve with more time — Postgres migration, Ruff config, ruleset-as-code for branch protection, Loom-walkthrough of hot-reload demo; (e) the 5–10 minute Loom link. Reference FR-013a's branch-protection caveat (admin UI step is out of scope; private-repo free-tier limitation). Link one green and one red CI run from T011.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** — no dependencies, can start immediately.
- **Foundational (Phase 2)** — depends on Setup; blocks US1 and US2.
- **US1 (Phase 3)** and **US2 (Phase 4)** — both depend only on Phase 2; can be implemented in parallel by different contributors.
- **US3 (Phase 5)** — depends on US1 and US2 being implemented (documents commands and flows that both must exist first). US3 is **not** blocked by either story's *acceptance verification*; the doc can be drafted against the committed code.
- **Polish (Phase 6)** — depends on US1 + US2 + US3 all complete and pushed to the feature branch.

### User Story Dependencies

- **US1 (local compose)**: independent of US2/US3.
- **US2 (CI)**: independent of US1/US3. Can land before or after US1.
- **US3 (parity/docs)**: requires US1 and US2 to have landed so the readme references real files.

### Within Each User Story

- Models before services before endpoints **does not apply** — this is an infrastructure feature; no domain code is added.
- Instead: config files (env/ignore) → Dockerfiles & entrypoints → compose/workflow files → acceptance smoke.

### Parallel Opportunities

- T003, T004, T005, T006 (US1 file creations) — all different files, all `[P]`.
- T009 and T010 (US2 file creations) — different files, both `[P]`.
- T015 and T016 (Polish verifications) — different checks, both `[P]`.
- Cross-story parallelism: once T001–T002 complete, Phase 3 and Phase 4 can proceed concurrently.

---

## Parallel Example: User Story 1

```bash
# After T001 + T002 complete, launch the four US1 file-creation tasks together:
Task: "Create backend/.env.example"                  # T003
Task: "Create backend/Dockerfile.dev"                # T004
Task: "Create backend/docker-entrypoint.sh (mode 0755)"  # T005
Task: "Create frontend/Dockerfile.dev"               # T006

# Then sequentially:
Task: "Create docker-compose.yml"                    # T007 (needs T003–T006)
Task: "Acceptance smoke per quickstart.md"           # T008 (needs T007)
```

## Parallel Example: User Story 2

```bash
# After Phase 2 completes:
Task: "Create .github/workflows/ci.yml"              # T009
Task: "Create docs/ci.md"                            # T010

# Then sequentially:
Task: "Open PR and verify all four jobs pass/fail correctly"  # T011
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 Setup (T001).
2. Phase 2 Foundational (T002).
3. Phase 3 US1 (T003–T008).
4. **STOP and VALIDATE** — the take-home's Story 1 promise is deliverable here.
5. If timebox is burning, submit with US1 only and note US2/US3 as follow-ups in the PR description.

### Incremental Delivery

1. Phase 1 + Phase 2 → foundation ready.
2. Add US1 (compose) → demo locally → commit.
3. Add US2 (CI) → push → observe four green jobs → commit.
4. Add US3 (readme + parity verification) → commit.
5. Phase 6 polish + PR description → open PR.

### Parallel Team Strategy

If two contributors:

1. Both: Phase 1 + Phase 2 together.
2. Contributor A: Phase 3 (US1). Contributor B: Phase 4 (US2).
3. Either: Phase 5 (US3), which depends on both landing.
4. Either: Phase 6 (polish + PR description).

---

## Notes

- No net-new test tasks. The existing `pytest` and `vitest` suites provide the test signal; CI (US2) executes them automatically.
- `[P]` marks only tasks that touch different files and have no dependency on incomplete tasks.
- Task IDs are sequential execution-order IDs; parallel groups may be reshuffled, but gaps are disallowed.
- Commit after each task or logical group so CI runs get tight signal.
- Stop at any checkpoint to demo or hand off.
- Avoid: touching any file under `backend/app/**`, `frontend/src/**`, or `backend/scripts/seed_data.py` (constitution Principle I + FR-003).
