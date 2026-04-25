# Continuous Integration

## Jobs

Every PR to `main` and every push to `main` runs four parallel jobs on
`ubuntu-latest`:

| Status name | Command | Working dir |
| --- | --- | --- |
| `backend-tests` | `pytest` | `backend/` |
| `frontend-tests` | `npm run test` | `frontend/` |
| `frontend-lint` | `npm run lint` | `frontend/` |
| `compose-build` | `docker compose build` | repo root |

Workflow file: [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Reproduce a failure locally

Copy the command from the table above and run it from the same commit.
Same environment (Python 3.11 / Node 20) is the cheapest way to match CI.

## Enable merge-blocking (repo owner, one-time)

CI reports statuses on every PR. To actually **block** merge on red:

1. Repo → **Settings → Rules → Rulesets → New branch ruleset**.
2. Target: default branch (`main`).
3. Enable **Require status checks to pass**.
4. Add required checks (names must match exactly):
   - `backend-tests`
   - `frontend-tests`
   - `frontend-lint`
   - `compose-build`
5. Save.

**Free-tier private repos**: branch protection is unavailable. Options:
make the repo public, upgrade to GitHub Pro, or gate merges manually.
