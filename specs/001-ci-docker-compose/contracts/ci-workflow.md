# Contract: GitHub Actions CI workflow

**Artifact**: `.github/workflows/ci.yml`

## Triggers

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

- **Excluded**: `pull_request_target` (would leak secrets to fork PRs, see
  `research.md` §10).

## Concurrency

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

## Permissions

```yaml
permissions:
  contents: read
```

No other scopes. No `secrets.*` references anywhere in the file.

## Jobs

All four jobs MUST run in parallel (no inter-job `needs:`). Each job MUST use
`runs-on: ubuntu-latest` and a pinned action version.

### `backend-tests`

- **Working directory**: `backend`
- **Status name published**: `backend-tests`
- **Steps** (in order):
  1. `actions/checkout@v4`
  2. `actions/setup-python@v5` with:
     - `python-version: "3.11"`
     - `cache: pip`
     - `cache-dependency-path: backend/requirements.txt`
  3. `pip install -r requirements.txt`
  4. `pytest`
- **Blocking**: yes (required check candidate).

### `frontend-tests`

- **Working directory**: `frontend`
- **Status name published**: `frontend-tests`
- **Steps**:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with:
     - `node-version: "20"`
     - `cache: npm`
     - `cache-dependency-path: frontend/package-lock.json`
  3. `npm ci`
  4. `npm run test`
- **Blocking**: yes.

### `frontend-lint`

- **Working directory**: `frontend`
- **Status name published**: `frontend-lint`
- **Steps**:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` (same settings as above).
  3. `npm ci`
  4. `npm run lint`
- **Blocking**: yes.

### `compose-build`

- **Working directory**: repository root
- **Status name published**: `compose-build`
- **Steps**:
  1. `actions/checkout@v4`
  2. `docker/setup-buildx-action@v3` (enables BuildKit caching).
  3. `docker compose build`
- **Blocking**: yes.
- **No services started.** (research.md §11)

## Non-goals (explicit)

- Matrix testing across Python/Node versions. The single pinned version is
  sufficient for a 3h take-home (research.md §8).
- Coverage uploads, artifact publishing, image registry pushes.
- Deploys to any environment.
- Self-hosted runners.

## Parity contract

| Command in CI | Equivalent local command | Source |
|---|---|---|
| `pytest` in `backend/` | `pytest` (from `readme.md:67`) | `backend-tests` |
| `npm run test` in `frontend/` | `npm run test` (from `readme.md:78`) | `frontend-tests` |
| `npm run lint` in `frontend/` | `npm run lint` | `frontend-lint` |
| `docker compose build` | `docker compose build` | `compose-build` |

Exact string equality above is the parity guarantee asserted in FR-018.

## Required-check names (for branch protection)

Document in `docs/ci.md` that the four names to add as required checks are:

```text
backend-tests
frontend-tests
frontend-lint
compose-build
```

These match the `jobs.<id>` keys in the YAML (GitHub uses the job ID as the
status name when no `name:` override is set).

## Post-merge behavior

On `push` to `main`, the same jobs run to keep the badge on `readme.md`
authoritative. No additional post-merge actions (no auto-tag, no deploy).
