# Backend API test harness (curl-based)

End-to-end integration tests for the FastAPI backend, driven with plain
`curl` + `jq`. Complements `backend/tests/` (pytest) by exercising the
live HTTP surface the frontend consumes, including auth, CRUD, the
15-minute platform gap, series creation with the 4-stage template, the
single-platform invariant, clone-to-another-platform with `family_id`
grouping, and a full creator workflow end-to-end.

## Layout

```
test-plan/
├── README.md             this file
├── run.sh                orchestrator — runs one / some / all suites
├── lib/
│   └── common.sh         shared helpers (curl wrapper, assertions, state)
└── suites/
    ├── 01-health.sh      server reachable + auth required where expected
    ├── 02-auth.sh        register / login / duplicate / wrong password / 401
    ├── 03-posts.sh       CRUD + archive / unarchive + 15-min platform gap
    ├── 04-series.sh      4-stage create / mixed-platform 422 / archive cascade
    ├── 05-family.sh      clone joins family_id; flat chain; unknown source 404
    ├── 06-e2e-scenario.sh full launch workflow: register → posts → series → clone
    └── 07-ownership.sh   cross-user isolation (FR-028): userB can't touch userA's stuff
```

`fixtures/` is a temp scratch dir created at runtime for curl response bodies;
you can delete it anytime.

## Prerequisites

- `curl` (any modern version)
- `jq` 1.6+
- `bash` 3.2+ — works on macOS default and any Linux

## Running

Start the backend first. From the repo root:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
# ... or: docker compose up backend
```

Then in a second terminal:

```bash
cd test-plan
./run.sh                    # all suites
./run.sh auth posts         # just those two
./run.sh --verbose auth     # show raw curl traffic
API_BASE=http://staging.local/api/v1 ./run.sh   # point at a non-local server
```

The orchestrator prints a per-suite summary and a global tally. Exit
code is the number of failed suites (0 = all passed), so it's
CI-friendly:

```bash
./run.sh && echo "deploy ok" || echo "deploy blocked"
```

Each suite can also be run standalone — they're self-contained bash
scripts that source `lib/common.sh`:

```bash
./suites/03-posts.sh
./suites/05-family.sh --verbose
```

## What's covered

| Area | Assertions |
| --- | --- |
| Health + auth required on protected routes | `/series` without token → 401 |
| Register (new user, duplicate email), login (correct, wrong password), bogus token | 6 tests |
| Posts CRUD, archive/unarchive, 15-min gap (same platform rejected, different platform accepted), deletion, 404 on gone | 11 tests |
| Series: 4-stage happy path, mixed-platform rejected (422 `mixed_platform_series`), out-of-order stage label rejected, <4 stages rejected, archive cascades to child posts, unarchive restores, delete of clean series | 10 tests |
| Clone / family: source self-references (`family_id == id`), clone via `source_series_id` inherits source's `family_id`, clone-of-clone stays flat (points at original anchor), unknown `source_series_id` → 404 `source_series_not_found` | 6 tests |
| End-to-end creator workflow: register → 2 standalone posts on different platforms → 4-stage IG series → clone to Twitter → verify family → archive/unarchive clone → delete clone → source untouched | 14 assertions |
| Cross-user isolation (FR-028): user B hits every GET / PATCH / DELETE / archive / unarchive endpoint for user A's post + series → 404. Cloning A's series via `source_series_id` → 404. List endpoints for B don't leak A's rows. After B's attacks, A's resources are untouched. | 15 tests |

Every suite registers a fresh user with a random email (`tester-$(timestamp)-$$-$RANDOM@example.com`)
so re-running against the same DB doesn't pollute state from prior runs or collide
with other suites.

## How assertions work

The curl wrapper in `lib/common.sh` populates two globals after each call:

- `HTTP_STATUS` — integer status code
- `RESPONSE_BODY` — raw response body

Tests then call helpers:

- `assert_status 201`
- `assert_json_eq '.status' 'scheduled'`
- `assert_json_nonempty '.access_token'`
- `assert_json_contains '.detail.error' 'mixed_platform_series'`

Each assertion increments counters; `begin_test` starts a test block; the
suite ends with `print_summary` which prints pass/fail counts and exits
non-zero if any test failed.

## Troubleshooting

- `FATAL: server not reachable at ...` — start the backend first.
- `jq: command not found` — `brew install jq` / `apt-get install jq`.
- Some tests fail with 409 `platform_gap_conflict` out of nowhere — your DB
  has posts from prior runs on the same platform within 15 minutes of the
  test's chosen time. Each suite generates times with `+N` minutes offsets
  from "now" plus a random jitter; if your DB has been seeded with posts
  near "now" this can collide. Fix: use a fresh dev DB or override
  `TEST_BASE_MINUTES` (see `lib/common.sh`).
