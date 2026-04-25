# Content Series

Adds Content Series — a creator can plan a sequence of posts on a shared
cadence (launch teaser → announcement → follow-up → reminder) instead of
scheduling each post individually. Enforces the assignment's one hard
constraint: posts on the same platform MUST NOT be scheduled within 15
minutes of each other.

Zero changes under `frontend/src/pages/PostEdit.jsx`, `frontend/src/pages/Login.jsx`,
`frontend/src/pages/Register.jsx`, `backend/app/api/auth.py`, `backend/app/core/security.py`,
or `backend/scripts/seed_data.py` — the infra-only PR (`001-docker-compose`)
plus this PR together leave existing user-facing code untouched except where
additive.

## Approach

1. **Scheduling invariant first.** New `backend/app/core/scheduling.py` with
   `check_platform_gap` (pure read, strict `<` / `>` boundaries so exactly
   15 min apart is accepted) and `generate_schedule` (cadence math). Wired
   into `POST /api/posts`, `PATCH /api/posts/{id}`, and `POST /api/series`.
   Tests written first, observed failing, then the implementation landed —
   per Constitution Principle IX (Test-First for Backend API, NON-NEGOTIABLE).
2. **Series domain.** New `Series` model + two nullable columns on `Post`
   (`series_id`, `series_position`). `PostResponse` gains read-only series
   fields so the UI can surface membership. Schema evolves via an
   idempotent `ALTER TABLE ... ADD COLUMN` in `init_db()` — reviewers do
   NOT need to reset their SQLite file (Clarifications Q2 = C).
3. **Series API.** `backend/app/api/series.py` exposes `POST/GET/PATCH/DELETE /api/series`.
   `POST /api/series` materializes the full post list atomically: N
   scheduled_at values, pairwise sibling precheck (defensive), per-time
   `check_platform_gap` call, then a single transaction inserts the series
   row plus N posts. First-conflict-wins; zero partial writes on abort
   (FR-003 + FR-011 amendment).
4. **Frontend.** New `seriesApi` in the client, three new pages
   (`SeriesList`, `SeriesEdit`, `SeriesDetail`), a nav link, and a
   "Series #N" badge on the existing posts list. `SeriesEdit` previews
   the computed schedule live as the creator types cadence and count
   (FR-020).
5. **Seed data enrichment.** `backend/scripts/seed_data.py` now creates
   one example series per seeded user (3 total: "Product launch
   campaign", "Weekly dev log", "Daily reminders"). Series posts are
   scheduled at least 30 days out so they cannot collide with the
   randomly-generated standalone posts (-7..+14 days). Reviewers logging
   in see a populated Series page immediately.

## Assumptions

- `15-min same-platform` rule is **per-owner** (Assumptions block, Clarify-Q1 default).
- Generated series posts default to `status="scheduled"` because the
  creator has explicitly picked a timestamp.
- Deleting a series cascades to its posts, including `published` ones —
  `published` is a cosmetic label in this MVP (Clarify-Q5). In production
  I'd switch to detach-published + cascade-rest.
- Daily / weekly cadences only; monthly is follow-up.
- One platform per series; multi-platform series would need FR-005b
  relaxed and cross-platform 15-min checks. Out of scope for v1.
- Past `start_at` is accepted for backfill (Clarify-Q6).
- Post titles frozen at creation — renaming a series does NOT retitle
  its existing posts (Clarify-Q8). Smart-cascade is a v2 feature.

## Tradeoffs

| Decision | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Migration strategy | **Idempotent `ALTER TABLE`** guarded by `PRAGMA table_info` | Alembic, or drop-and-reseed | No new deps (Principle II); reviewer does nothing extra. See Clarifications Q2 and `research.md` §2. |
| `series_post_index` in 409 body | Optional field only on series-create | Always present / always absent | Lets frontend switch on presence (single-post vs series-create). Documented in FR-011 (analysis remediation I1). |
| Post title format | Auto `"{series.title} — part {i+1}"` | Empty / per-post input form | Zero extra form UI; non-null title satisfied immediately (Clarify-Q4 / FR-002a). |
| Platform change on series post | **400** reject | 409 | Reserve 409 for `platform_gap_conflict`; frontend handlers switch on `detail.error` cleanly (analysis remediation I7 / FR-005b). |
| Cascade delete incl. `published` | Unconditional | Detach-published then cascade-rest | Simplest for v1; `published` is a label in this MVP (Clarify-Q5 / FR-006). |
| Test-First adoption for 002 | **Adopted** — not grandfathered | Invoke grandfather clause and ship fast | Honors Constitution v1.2.0 Principle IX's spirit; the tests were already planned, re-ordering them cost ~0 (Tasks-Q1). |
| Edit-series UI | **Hidden** in v1 | Link to a stub page | Editing only title/description via UI would need a small EditSeries form not in scope — `/docs` covers the edge case (analysis remediation I2 / FR-005). |

## Constitution compliance (v1.2.0)

| Principle | Status |
| --- | --- |
| I — Extend, Don't Rewrite | Pass. Only additive edits to existing files. |
| II — Stay on the Existing Stack | Pass. Zero new runtime deps. SQLite retained. |
| III — Enforce Scheduling Invariants (NON-NEGOTIABLE) | Pass. `scheduling.py` + tests. Exactly-15-min boundary test. |
| IV — Pragmatic Test Coverage | Pass. Frontend tests pragmatic (no new Vitest beyond existing 16). |
| V — Clear Structure & Documented Tradeoffs | Pass. This section + Loom. |
| VI — Spec Conflict Resolution at Gates (NON-NEGOTIABLE) | Pass. Eight Clarifications recorded (2 pre-spec, 3 clarify session 1, 3 clarify session 2, plus Tasks-Q1); see `specs/002-content-series/spec.md` Clarifications and `questions/002-content-series-pre-spec-answers.md`. |
| VII — User-Friendly UI | Pass. Loading/error/empty states in all 3 new pages; destructive-action `window.confirm`; nav link added. FR-018a codifies the requirement. |
| VIII — Code Quality | Pass. Idiomatic SQLAlchemy async + Pydantic v2; no dead code; no emoji. |
| IX — Test-First for Backend API (NON-NEGOTIABLE) | Pass. Five TF cycles (T008/T009, T010/T011, T012/T013, T014/T015, T018/T019) each observed red before green. Grandfather clause NOT invoked. |
| X — API Compatibility & UX Consistency | Pass. Shared `_raise_platform_gap_conflict` helper makes single-post and series-create responses identical. `PostResponse` additions are additive. |

**Zero unjustified deviations.** All planning-time amendments
(FR-002a, FR-005a, FR-005b, FR-006 cascade, FR-008 status-agnostic,
FR-011 series_post_index, FR-018a, etc.) live in `spec.md`'s
Clarifications section with rationale.

## How I verified it locally

- **Backend suite**: 54 tests pass in 31s (14 pre-existing auth+posts +
  6 new invariant cases on `/api/posts` + 3 FR-005a/FR-005b guards + 16
  `test_scheduling.py` + 15 `test_series.py`).
- **Frontend suite**: `npm run test` → **22 tests pass** (16 existing + 6
  new `seriesApi` cases covering list/get/create/update/remove and a
  409-with-`detail.message`-object error path).
- **One bug uncovered and fixed**: the 409 error test surfaced that
  `client.js` fell back to `[object Object]` when `detail` was an object
  (the FR-011 shape). Fixed inline so `SeriesEdit.jsx` actually shows
  the server's `detail.message` verbatim per FR-018a / Principle VII.
- **Frontend lint**: `npm run lint` → exit 0 (2 pre-existing warnings
  from `AuthContext.jsx` still warn-level per the `001` decision).
- **Compose build**: `docker compose build` → both images green.
- **Live stack smoke**: `docker compose up`, logged in as alice, hit
  `POST /api/series` → 201 with 4 posts on weekly cadence, each
  auto-titled `"Smoke test series — part N"`; hit `POST /api/series`
  again with start_at 5 min after the first generated post → 409 with
  `series_post_index: 0`, `delta_minutes: -5.0`, and the
  `platform_gap_conflict` message identifying the conflicting existing
  post. Atomic abort confirmed (no series row; only the first series'
  posts present).

## What I would improve with more time

- **Real background publisher** (transitions `scheduled → published` at
  the right time). Would need APScheduler / Celery (Principle II
  deviation) and the `research.md` §11 outline: Postgres for row-level
  locking, SERIALIZABLE isolation to guard the publisher race, async
  queue for platform-side HTTP calls.
- **Option B cascade on series delete** — detach `published` posts
  (`series_id = NULL`) instead of cascading them out of history, with a
  `posts(series_id)` index to keep the UPDATE fast.
- **Smart-cascade on series rename** (Clarify-Q8 option C) — update only
  posts whose titles still match the original `"{title} — part N"`
  pattern; skip manually-edited ones.
- **Multi-platform series** — relax FR-005b, relax the single-platform
  assumption, and add cross-platform collision checks.
- **Monthly / custom cadences** — parametrize `generate_schedule` with
  an iCal RRULE-style input.
- **Series edit in the UI** — a small `SeriesEdit`-in-edit-mode form so
  renaming doesn't require hitting `/docs`.
- **More frontend component tests** — the `seriesApi` client is now covered (T027 landed), but `SeriesEdit.jsx`'s cadence-preview math and `SeriesDetail.jsx`'s delete-confirmation path still rely on manual smoke.
- **Backend Ruff lint** — closes the `001` FR-012c deferral.
- **Vitest + RTL smoke for `SeriesEdit` cadence preview math** so the
  client-side `generate_schedule` mirror stays in sync with the backend.

## Loom

TODO: paste the 5–10 min walkthrough link here after recording. Planned
beats: (a) `docker compose up` → working app; (b) create a 4-post weekly
series in the UI with live preview; (c) trigger the 409 platform-gap
path and observe the toast surfaces `detail.message` verbatim;
(d) walk through `backend/app/core/scheduling.py` + one of the TF
cycles in the test file pair, pointing at the exact-15-min boundary
test; (e) call out the eight Clarifications and the v1.2.0 constitution
amendments.

## CI run links

TODO: paste one green-run link after pushing this branch. If a red run
was triggered during `T011`-style manual testing, paste that too.

## Spec-kit artifacts

Full workstream for reviewers:

- [`specs/002-content-series/spec.md`](specs/002-content-series/spec.md) — 23 FRs + 8 Clarifications.
- [`specs/002-content-series/plan.md`](specs/002-content-series/plan.md)
- [`specs/002-content-series/research.md`](specs/002-content-series/research.md)
- [`specs/002-content-series/data-model.md`](specs/002-content-series/data-model.md)
- [`specs/002-content-series/high-level-design.md`](specs/002-content-series/high-level-design.md) — HLD with 8 mermaid diagrams.
- [`specs/002-content-series/contracts/`](specs/002-content-series/contracts/)
- [`specs/002-content-series/tasks.md`](specs/002-content-series/tasks.md) — 36 tasks, 34 complete (T035 push + T036 Loom pending; the two "optional" tasks T027 and T032 were also completed).
- [`plan/002-analysis-report.md`](plan/002-analysis-report.md) — `/speckit-analyze` report with 9 findings (5 applied, 4 deferred).
- [`questions/002-content-series-pre-spec-answers.md`](questions/002-content-series-pre-spec-answers.md) — full Q&A log for the 8 clarifications and Tasks-Q1.
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — constitution v1.2.0 (10 principles).
