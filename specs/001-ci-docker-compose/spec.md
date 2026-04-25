# Feature Specification: CI & Local Docker Compose

**Feature Branch**: `001-docker-compose`
**Created**: 2026-04-22
**Status**: Draft
**Input**: User description: "Setup github CI for this project. Also need a docker-compose for this project so i can host both frontend/backend and db part from my local"

## Clarifications

### Session 2026-04-22

- Q: Which database engine should the local compose stack and CI use? → A: Keep SQLite; persist `scheduler.db` on a named Docker volume mounted into the backend container; no separate DB service; CI continues to use the existing in-memory SQLite. Rationale to record in the PR description: keep the existing functionality working before any migration to a production-grade DB; Postgres is a follow-up, not part of this feature.
- Q: What should the CI pipeline cover beyond running tests? → A: Tests + lint + a docker-compose build smoke job. Lint uses the existing frontend ESLint (`npm run lint`); the backend has no linter committed today, so Python lint is scoped as a blocking job only if it can be added without new configuration (otherwise it is deferred as a follow-up and the PR description notes this deviation per Principle II). Compose-build is `docker compose build` against the committed compose file; it does not start services.
- Q: How should seed data be applied when the local compose stack starts? → A: Auto-seed only when the database is empty (detected by the absence of the seeded user `alice@example.com`); otherwise the seed step is a no-op. Rationale: the existing `backend/scripts/seed_data.py` is idempotent for users but appends fresh random posts every run, so gating the script on emptiness is the minimum-change way to make restarts safe without modifying the script.
- Q: How should Story 2's "blocks merge" requirement be realized? → A: The workflow file produces per-job required statuses; a short documentation section explains how the repo owner enables branch protection / rulesets to require those statuses. The actual admin-UI toggle is out of scope for this PR and is flagged in the PR description. Caveat recorded: the user does not have a GitHub Team account, so enabling branch protection is only possible if the repository is **public** (free on personal accounts) or if the owner upgrades to Pro; on a free-tier **private** repo, Story 2's merge-blocking degrades to status-reporting only, and that limitation is documented rather than hidden.
- Q: How should CI execute the test and lint jobs — native on the runner, or inside docker-compose? → A: Native runner steps using `actions/setup-python` and `actions/setup-node` in parallel jobs that invoke the same commands a developer runs locally (`pytest`, `npm run test`, `npm run lint`). A separate parallel job runs `docker compose build` only; the full stack is not started in CI. Story 3 parity is preserved at the command level, which is the parity property the spec cares about.

### Session 2026-04-22 (readme-consistency refinement)

Prompted by a `/speckit-analyze` pass reviewing `readme.md` against the plan,
three implementation details were refined to align with the readme's
pre-existing mental model. No user-facing scope changed; only the persistence
mechanism and env-file path differ from the earlier session.

- **Refinement** — Persistence: the SQLite DB is persisted by **bind-mounting
  the host's `./backend` directory** into the backend container, not via a
  named Docker volume. `scheduler.db` therefore lives at
  `backend/scheduler.db` on the host, matching `readme.md:94`. The two
  workflows (non-Docker venv and Docker compose) intentionally share the
  same DB file so a developer switching between them sees the same data.
- **Refinement** — Env file: compose loads `./backend/.env` (via compose's
  `env_file:` directive), not a root-level `.env`. `.env.example` ships as
  `backend/.env.example`. This matches `readme.md:114` and avoids silently
  ignoring env values a developer set per the readme.
- **Refinement** — Python version framing: CI and the Docker backend image
  pin Python 3.11. The non-Docker workflow continues to support Python
  3.9+ as documented in `readme.md:20`; 3.11 is presented as a superset,
  not a replacement, and the updated readme will state this explicitly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One-command local environment (Priority: P1)

A developer who has just cloned the repository can start the full application stack
— frontend, backend, and database — with a single command from the repository root.
The stack comes up with seed data already loaded so the developer can log in
immediately and see realistic content.

**Why this priority**: Onboarding friction is the single biggest blocker for
reviewers evaluating a take-home and for new contributors. If the stack does not
start in one command, nothing else in this feature matters. This story alone
delivers standalone value even if no CI is set up.

**Independent Test**: On a clean machine with only Docker installed, run the single
documented start command and verify: (a) the frontend is reachable in a browser,
(b) login with a seeded account succeeds, (c) at least one seeded post is visible
in the UI. No other setup steps should be required.

**Acceptance Scenarios**:

1. **Given** a fresh clone and a working Docker installation, **When** the developer
   runs the documented single start command, **Then** the frontend, backend, and
   database are all running and reachable within a reasonable startup window, and
   seed data is present.
2. **Given** the stack is running, **When** the developer edits a frontend source
   file, **Then** the change is reflected in the browser without rebuilding the
   frontend image.
3. **Given** the stack is running, **When** the developer edits a backend source
   file, **Then** the backend reloads automatically and serves the updated code.
4. **Given** the stack has been stopped, **When** the developer starts it again,
   **Then** previously created data persists across restarts.

---

### User Story 2 - Automated quality gate on every change (Priority: P1)

When a developer pushes a branch or opens a pull request on the repository, an
automated pipeline runs the backend and frontend test suites plus the lint and
compose-build jobs, and reports pass/fail status directly on the pull request.
When the repo owner has enabled the documented branch-protection configuration,
failed runs also block merge.

**Why this priority**: Without an automated gate, regressions land silently. For a
project whose core correctness depends on a scheduling invariant, a red/green
signal on every PR is essential. This story is independently valuable even if
story 1 is not adopted — CI can run without the local compose setup.

**Independent Test**: Open a pull request that intentionally breaks a backend
test. Verify the pipeline runs and reports failure with a distinct per-job
status. If branch protection is enabled on the default branch, also verify
merge is blocked. Push a fix and verify the pipeline turns green (and merge is
allowed when protection is enabled).

**Acceptance Scenarios**:

1. **Given** a pull request is opened or updated, **When** the pipeline runs,
   **Then** the backend test suite and the frontend test suite both execute and
   their statuses are visible on the pull request.
2. **Given** any job in the pipeline fails, **When** the developer views the pull
   request, **Then** the failure is clearly surfaced with a distinct status
   per job, and — when the repo owner has enabled the documented branch
   protection / ruleset configuration — merge is blocked until the failure is
   resolved.
3. **Given** the default branch receives a new commit, **When** the pipeline runs
   against that commit, **Then** the same test suites execute and their status is
   visible on the commit.

---

### User Story 3 - Parity between CI and local (Priority: P2)

The test commands used by CI are the same commands a developer runs locally, so a
green local run is a strong predictor of a green CI run, and a red CI run can be
reproduced locally without guesswork.

**Why this priority**: Parity reduces "works on my machine" friction. It is not
required for a working MVP, but it meaningfully improves the feedback loop once
stories 1 and 2 exist.

**Independent Test**: Pick a failing CI run, copy the exact commands documented in
the repository, run them locally against the same commit, and confirm the same
failures appear.

**Acceptance Scenarios**:

1. **Given** the project documentation, **When** a developer runs the documented
   test commands locally, **Then** those commands match (or are trivially
   equivalent to) the commands executed by the pipeline.
2. **Given** a pipeline failure, **When** the developer reproduces the failing
   command locally, **Then** the same failure occurs.

---

### Edge Cases

- What happens when the developer's host machine already has the frontend (5173),
  backend (8000), or database port in use? The stack must fail with a clear,
  actionable error rather than silently binding to an unexpected port.
- What happens when the database volume already contains data from a previous
  run? The stack must start cleanly and the seed step must be a no-op (per
  FR-003), preserving any user-created data and not re-inserting duplicate
  seeded posts.
- What happens when CI runs on a pull request from a fork? The pipeline must still
  execute the test suites but must not expose repository secrets to fork PRs.
- What happens when tests pass locally but the developer forgot to commit a new
  dependency? CI must fail because it installs from lockfiles/requirements on a
  clean environment.
- What happens when the backend container starts and the bind-mounted SQLite
  file is absent (fresh clone, or developer manually deleted it)? The backend
  must initialize the schema and trigger the seed-on-empty path, or fail
  fast with a clear error — never serve partial/empty data silently.
- What happens when the frontend container cannot reach the backend? The failure
  must surface in logs with enough information to diagnose the network wiring.

## Requirements *(mandatory)*

### Functional Requirements

**Local Docker environment**

- **FR-001**: The repository MUST provide a single compose-based command that
  starts the frontend, backend, and database services together.
- **FR-002**: The SQLite database file MUST persist across container restarts.
  Persistence is achieved by bind-mounting the host's `./backend` directory
  into the backend container, so the database file lives at
  `backend/scheduler.db` on the host (matching the location documented in
  `readme.md`). No separate database service is introduced.
- **FR-003**: On every backend container start, the stack MUST run the existing
  seed script (`backend/scripts/seed_data.py`) **only when the database is
  empty**, where "empty" is defined as the absence of the seeded user
  `alice@example.com`. When the database is non-empty, the seed step MUST be a
  no-op, and the existing seed script MUST NOT be modified as part of this
  feature.
- **FR-004**: The frontend service MUST be reachable from the developer's host
  browser at a documented URL.
- **FR-005**: The backend service MUST be reachable from both the frontend
  container and the host, and its API docs MUST be viewable from the host.
- **FR-006**: Source code for the frontend and backend MUST be mounted into their
  respective containers so that edits on the host are reflected without rebuilding
  the image (hot reload for frontend, auto-reload for backend).
- **FR-007**: The backend service MUST verify on startup that its working
  directory (the bind-mounted backend tree) is readable/writable and that the
  SQLite file path resolves under that directory. It MUST fail fast with a
  clear error if the bind mount is missing or read-only, rather than
  silently writing the DB to an ephemeral container-local path.
- **FR-008**: Configuration values that differ between local and CI (e.g., secret
  key, database URL) MUST be supplied via environment variables with documented
  defaults suitable for local development.
- **FR-009**: The repository MUST document (in `readme.md` or a linked file) the
  exact commands to start, stop, rebuild, view logs, and reset the local stack.

**Continuous Integration**

- **FR-010**: The repository MUST run an automated pipeline on every pull request
  targeting the default branch and on every push to the default branch.
- **FR-011**: The pipeline MUST execute the backend test suite natively on the
  CI runner using a pinned Python version, invoking the same `pytest` command
  developers run locally. The pipeline MUST NOT require the full compose
  stack to be running to execute this suite.
- **FR-012**: The pipeline MUST execute the frontend test suite natively on
  the CI runner using a pinned Node version, invoking the same
  `npm run test` command developers run locally.
- **FR-012a**: The pipeline MUST execute `npm run lint` as a blocking job.
- **FR-012b**: The pipeline MUST execute `docker compose build` (without
  starting services) as a blocking job to catch broken Dockerfiles or compose
  file errors before merge.
- **FR-012c**: Backend (Python) lint is in scope for this feature only if it
  can be added without introducing new committed configuration beyond a
  minimal linter config file; otherwise it is explicitly deferred and the
  deviation is documented in the PR description per constitution Principle II.
- **FR-013**: The pipeline MUST fail the overall run if any test, lint, or
  compose-build job fails, and the failure MUST be visible on the associated
  pull request or commit. Each blocking job MUST publish a distinctly-named
  status so it can be used as a required check by the repo owner.
- **FR-013a**: The repository MUST document the exact steps for the repo owner
  to enable branch protection / rulesets on the default branch and mark the
  pipeline's jobs as required checks. Performing those steps in the GitHub
  admin UI is explicitly out of scope for this feature and is called out in
  the PR description. On a free-tier **private** repository, merge-blocking
  is unavailable; the documentation MUST note this limitation honestly.
- **FR-014**: The pipeline MUST install dependencies from the committed lockfiles
  / requirements files so that missing or outdated declarations are caught.
- **FR-015**: The pipeline MUST cache dependency installations between runs where
  safely possible to keep typical run time short.
- **FR-016**: The pipeline MUST NOT expose repository secrets to workflow runs
  originating from forked pull requests.
- **FR-017**: The pipeline configuration MUST live in a version-controlled file in
  the repository so that changes to CI behavior are reviewed like any other code
  change.

**Parity & docs**

- **FR-018**: The test and lint commands invoked by the pipeline MUST be the
  same commands documented in the repository for local use (e.g., `pytest`,
  `npm run test`, `npm run lint`), with parity evaluated at the command level.
  Executing these commands natively on the runner instead of inside the
  compose stack does not violate this requirement.
- **FR-019**: The repository's top-level documentation MUST point to both the
  local-compose workflow and the CI pipeline so a new contributor can find both
  within one minute of opening the repo.

### Key Entities *(include if feature involves data)*

- **Local stack**: The set of three cooperating services (frontend, backend,
  database) that together constitute the application on a developer's machine.
  Characterized by its start/stop lifecycle, its persistent data volume, and its
  environment-variable configuration surface.
- **CI pipeline run**: A single execution of the automated pipeline triggered by
  a pull request or push. Characterized by its trigger event, its per-suite
  pass/fail result, and its aggregate status reported to the PR/commit.
- **Environment configuration**: The named set of values (database URL, secret
  key, API URL, etc.) that parameterizes both the local stack and CI runs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with Docker installed and no other setup can go from a
  fresh clone to a logged-in, seeded frontend in under 10 minutes on a typical
  broadband connection (time dominated by first-time image pulls/builds).
- **SC-002**: After the first successful start, subsequent starts of the stack
  reach a browsable frontend in under 60 seconds on the same machine.
- **SC-003**: Data created through the UI survives at least one `stop`/`start`
  cycle of the stack with no manual re-seeding.
- **SC-004**: 100% of pull requests targeting the default branch trigger the
  automated pipeline, and 100% of pipeline failures are surfaced on the pull
  request within the pipeline's normal run time.
- **SC-005**: The pipeline's typical run time on an unchanged dependency set is
  under 5 minutes end-to-end, achieved by running independent jobs (backend
  tests, frontend tests, frontend lint, compose-build) in parallel.
- **SC-006**: A regression that breaks either test suite is caught by the
  pipeline before merge in 100% of cases.
- **SC-007**: A new contributor can locate both the local-start instructions and
  the CI status badge (or equivalent) from the repository root within 1 minute.

## Assumptions

- The project continues to use its current two-service application shape (a
  Python API and a JavaScript single-page app) plus one database; no additional
  services (cache, queue, search) are in scope for this feature.
- The database used locally via compose is SQLite (resolved in Clarifications
  2026-04-22). The `scheduler.db` file lives at `backend/scheduler.db` on
  the host, reached by bind-mounting `./backend` into the backend container.
  This choice aligns the Docker and non-Docker workflows on a single,
  host-visible DB location (matching `readme.md`). No separate database
  service is introduced, and CI continues to run the test suite against the
  existing in-memory SQLite configuration. A future migration to a
  server-style database (e.g., Postgres) is explicitly deferred to a later
  feature; the rationale — keep current functionality working first — will be
  called out in the PR description per constitution Principle V.
- The repository is hosted on GitHub and the automated pipeline is expected to
  run on GitHub-hosted runners. No self-hosted infrastructure is assumed.
- "Local" means a developer workstation running macOS, Linux, or Windows with
  a working Docker Desktop / Docker Engine installation. Non-Docker local
  workflows (the existing `uvicorn` + `npm run dev` path documented in
  `readme.md`) remain supported and are out of scope for replacement.
- Secrets needed by CI (if any beyond defaults) are configured by the repository
  owner through the hosting provider's standard secrets mechanism.
- Deployment to a remote environment (staging, production) is out of scope; this
  feature covers only local development ergonomics and pre-merge quality gates.
