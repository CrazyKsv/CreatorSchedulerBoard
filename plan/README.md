# Content Series — Development Plan

Plan for the core assignment (see [`../REQUIREMENTS.md`](../REQUIREMENTS.md)
and [`../ASSIGNMENT.md`](../ASSIGNMENT.md)): add Content Series support to the
existing Creator Scheduler without rewriting it.

"How to get started" (local stack + CI) is already done on `001-docker-compose`
— see [`../specs/001-ci-docker-compose/`](../specs/001-ci-docker-compose/).

## Goal

Let a creator plan a **sequence** of posts on a shared cadence (launch
teaser → announcement → follow-up → reminder) instead of scheduling each
post individually. Enforce one hard rule: posts on the same platform must
be at least 15 minutes apart.

## Timebox

~3 hours total. If I have to cut, I cut UI polish first and scheduling
correctness last.

## Current state (what exists today)

| Area | Status |
| --- | --- |
| `User` model | present |
| `Post` model (`title`, `platform`, `scheduled_at`, `status`, `owner_id`) | present, no series linkage |
| `/api/auth/register`, `/api/auth/login` | present |
| `/api/posts` CRUD | present, accepts any `scheduled_at` without checks |
| Frontend: Login, Register, PostsList, PostEdit, CalendarPage | present |
| Auto tests: auth + post CRUD | present, no scheduling-invariant coverage |
| **Series concept** | **missing entirely** |
| **15-min same-platform invariant** | **not enforced anywhere** |

## Gap analysis (vs. REQUIREMENTS.md)

See [`gaps.md`](./gaps.md) for the full table. Summary:

1. **No Series model, schema, or API.** Everything about series has to be built.
2. **No scheduling invariant enforcement.** Today you can create two Instagram posts at the same timestamp through either the UI or a `curl`. This is the assignment's one hard constraint and the constitution's one NON-NEGOTIABLE (Principle III).
3. **Seed data doesn't exercise series.** The existing `seed_data.py` generates isolated posts only.
4. **UI has no notion of series.** PostsList/PostEdit/Calendar are all flat.

## Proposed design

### Data model (new)

Add a `Series` entity plus two columns on `Post`:

```text
Series
  id                integer PK
  title             string, required
  description       string, optional
  platform          string, required    # one platform per series (v1 simplification)
  start_at          datetime, required  # first post's scheduled time
  cadence_unit      enum("days", "weeks")
  cadence_interval  integer             # every N units
  post_count        integer             # how many posts to generate (1..20)
  owner_id          FK → users.id
  created_at, updated_at

Post (add two columns; existing columns unchanged)
  series_id         FK → series.id, nullable
  series_position   integer, nullable   # 0-indexed slot within the series
```

Relationships: `User → Series (1:N)`, `Series → Post (1:N)`, `Post.series_id`
optional so standalone posts still work.

Why these choices:

- **Single platform per series** — the 15-min rule is per-platform; one platform per series keeps collision checking simple for v1. Multi-platform series are a follow-up.
- **Pre-materialized posts** (create all posts up-front from the series) rather than compute on-demand. Reasons: existing `/api/posts` endpoints keep working unchanged, the calendar view Just Works, and the DB is the source of truth. Tradeoff: editing cadence after creation is harder — out of scope for v1.
- **`cadence_unit` enum-as-string** matches the existing `status` pattern in `Post`.
- **`post_count` capped at 20** to keep the bulk-create path bounded.

Full shape, invariants, and migration plan in [`data-model.md`](./data-model.md).

### Scheduling invariant (NON-NEGOTIABLE)

- New module: `backend/app/core/scheduling.py`.
- Pure function `check_platform_gap(db, owner_id, platform, scheduled_at, exclude_post_id=None, buffer_minutes=15)` that returns `None` or a `Conflict(other_post_id, other_scheduled_at, delta_minutes)`.
- Called from:
  - `POST /api/posts` (new post)
  - `PATCH /api/posts/{id}` (reschedule)
  - `POST /api/series` (bulk — check every generated post against all existing posts AND against the series' own siblings; abort atomically if any conflict)
- On conflict: `HTTP 409 Conflict` with a JSON body naming the other post and the time delta. No partial writes for the series path.
- Only applies to posts with a non-null `scheduled_at`. Drafts are free.
- Exact-boundary (≥15 min apart to the second) is accepted; <15 min is rejected. Matches the spec's test guidance.

### API (new endpoints)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/series` | Create series + materialize all posts atomically |
| `GET` | `/api/series` | List the authed user's series |
| `GET` | `/api/series/{id}` | One series with its posts, ordered by `series_position` |
| `PATCH` | `/api/series/{id}` | Edit `title`/`description` only (v1 does not re-schedule posts) |
| `DELETE` | `/api/series/{id}` | Delete series; cascade delete its posts |

Existing `/api/posts` endpoints stay as-is. `PostResponse` gains two optional
fields (`series_id`, `series_position`) so the UI can show membership.

### UI (new + updated)

New pages:

- `/series` — list of the user's series (title, platform, cadence, post count, start date).
- `/series/new` — create form: title, platform, start date, cadence (`every N days | weeks`), number of posts. Preview-computed schedule before submit.
- `/series/:id` — detail: series metadata plus the generated posts, each linking to the existing `PostEdit` route.

Updated:

- `PostsList` — show a small "Series: {title}" badge when `series_id` is set.
- `Layout` nav — add a `Series` link.
- `CalendarPage` — (optional polish) color-code series posts by series id.

Route wiring lives in `frontend/src/App.jsx`. API client additions live in
`frontend/src/api/client.js` as a `seriesApi` object next to `postsApi`.

## Phased implementation

See [`tasks.md`](./tasks.md) for the full ordered checklist. Summary:

### Phase A — Scheduling invariant first (30–45 min)

Start with the invariant because it's the one hard constraint and it's
needed by every other phase.

1. `backend/app/core/scheduling.py` with `check_platform_gap`.
2. Wire into `POST /api/posts` and `PATCH /api/posts/{id}`.
3. Extend `backend/tests/test_posts.py`: within-window rejection, exact 15-min boundary acceptance, different-platform same-time allowed, different-user same-time allowed (or NOT, depending on clarified answer — see Open Questions).

**Checkpoint**: existing post CRUD now enforces the rule. This alone is valuable.

### Phase B — Series backend (45–60 min)

1. `backend/app/models/series.py` + `Post.series_id` / `series_position` columns. Add to `User.series` relationship.
2. `backend/app/schemas/series.py` — `SeriesCreate`, `SeriesUpdate`, `SeriesResponse`.
3. `backend/app/api/series.py` — the 5 endpoints listed above. `POST /api/series` calls `check_platform_gap` for each materialized post before committing; aborts with 409 on any conflict.
4. Wire `router` into `app/main.py`.
5. `backend/tests/test_series.py` — create (happy path), create with conflict (full abort), cadence math, scoped to owner, delete cascades posts.

**Checkpoint**: backend supports the full series story; UI can be exercised via `/docs`.

### Phase C — Frontend series UI (45–60 min)

1. `frontend/src/api/client.js` — add `seriesApi` (list/get/create/update/delete).
2. `frontend/src/pages/SeriesList.jsx` — list.
3. `frontend/src/pages/SeriesEdit.jsx` — create-only for v1 (title/platform/start/cadence/count + preview).
4. `frontend/src/pages/SeriesDetail.jsx` — metadata + generated posts.
5. Wire routes in `App.jsx`; add nav link in `Layout.jsx`.
6. Augment `PostsList.jsx` to show a series badge when `series_id` is present.

**Checkpoint**: happy-path demo-able.

### Phase D — Polish + PR (15–30 min)

1. Update seed script to create one example series per user (optional; adds visual interest for reviewers). If time-constrained, skip.
2. Update `readme.md` with a short "Content Series" section.
3. PR description per constitution Principle V (approach, assumptions, tradeoffs, improvements, Loom).
4. Loom recording.

## Open questions (to resolve before or during Phase A)

1. **Does the 15-min rule apply across different users?** My default: **no** — it's per-owner. Two creators sharing an Instagram account would not use one shared Post row; each has their own account. Confirm.
2. **Status of auto-generated series posts**: default to `"scheduled"` or `"draft"`? My default: `"scheduled"` — creators picking a date clearly intend to schedule, and the rule is only enforced on non-null `scheduled_at` which matches.
3. **Deleting a series**: cascade posts or orphan them (`series_id = NULL`)? My default: **cascade**. Simpler, matches "delete the plan, delete the plan's artifacts". Edit series is out of scope anyway.
4. **Cadence beyond daily/weekly**: do we need monthly? My default: **no** — out of scope for v1.

If these materially change the design, run `/speckit-clarify` before Phase B.

## Out of scope for this iteration

- Multi-platform series (one platform per series in v1).
- Editing cadence after series creation (you get create + delete; re-plan = delete + recreate).
- Monthly or custom cadences.
- Bulk operations on series (e.g., "mark all scheduled").
- Moving an existing standalone post **into** a series.
- Notifications / scheduled publishing (there's no actual publisher — `status=published` is a label only).
- Postgres migration (deferred per the just-merged infra PR).
- Backend Python lint (Ruff) — still deferred per FR-012c.
- Fixing the two legacy ESLint violations in `AuthContext.jsx` — still follow-up.

## Deliverables

- A feature branch (e.g., `002-content-series`) cut from `main` after the `001-docker-compose` PR merges.
- A PR into the candidate's own `main` with the Principle V description + Loom.
- Green CI on the new branch (all four jobs from `001-docker-compose`).

## See also

- [`gaps.md`](./gaps.md) — detailed current-vs-required gap table.
- [`data-model.md`](./data-model.md) — Series schema, invariant pseudocode, migration strategy.
- [`tasks.md`](./tasks.md) — ordered execution checklist.
