# Phase 0 Research: Content Series

**Feature**: `specs/002-content-series`
**Date**: 2026-04-22

All decisions below were made during `/speckit-specify` (pre-spec halt) or
`/speckit-clarify` (post-spec clarification) per Constitution Principle VI,
or derived from reading the current codebase. Nothing is open.

## 1. Scope of "scheduler"

**Decision**: Series-only scheduling. Materialize N posts with correct
`scheduled_at` values; enforce the 15-min rule; **do not** publish anything.
`status` remains a passive label.

**Source**: Clarifications session 2026-04-22 (pre-spec Q1) → option A.

**Alternatives considered**:

- **B. Add a background publisher** (APScheduler / FastAPI `BackgroundTasks`
  loop / external cron hitting an endpoint) to transition `scheduled →
  published`. Rejected: adds ~1–1.5 h to the 3 h timebox, introduces a
  dependency or a timer mechanism that collides with Principle II's "no new
  services, databases, queues, or background workers" clause, and is not
  asked for by `REQUIREMENTS.md`.
- **C. Narrow to invariant-only**. Rejected: would drop Series entirely
  which directly contradicts `REQUIREMENTS.md`'s Content Series brief.

## 2. DB schema rollout

**Decision**: Idempotent ALTER on startup. In `backend/app/core/database.py`'s
`init_db()`, after `Base.metadata.create_all`, run a guarded
`ALTER TABLE posts ADD COLUMN ...` for each of `series_id` and
`series_position`. Guard is a `PRAGMA table_info(posts)` check so repeat
starts are no-ops.

**Source**: Clarifications session 2026-04-22 (pre-spec Q2) → option C.

**Why this shape**:

- Works on a fresh DB (create_all generates the new `posts` columns and the
  new `series` table from SQLAlchemy definitions, so the ALTER short-circuits
  as "already present").
- Works on an existing reviewer DB from `001-docker-compose` (the new
  `series` table gets created by `create_all`, and the ALTER adds the two
  missing columns on `posts`).
- No new deps (Principle II).
- Invisible to reviewers — no reset command required (SC-003).

**Alternatives considered**:

- **A. Drop-and-reseed**. Rejected: reviewer UX cost.
- **B. Alembic**. Rejected: new dependency friction + ~30–45 min overhead.

## 3. PATCH /api/posts/{id} and series membership

**Decision**: `PATCH /api/posts/{id}` MUST NOT mutate `series_id` or
`series_position`. Series membership is write-once.

**Source**: Clarify-Q1 → option A.

**Implementation implication**: the existing `PostUpdate` Pydantic schema
adds **no new fields**. `PostResponse` exposes `series_id` and
`series_position` as read-only. `PostEdit.jsx` frontend is untouched.

## 4. Status filter for the 15-min invariant

**Decision**: All posts with a non-null `scheduled_at` count, regardless of
`status`. Drafts with null `scheduled_at` are naturally exempt.

**Source**: Clarify-Q2 → option A.

**Implementation implication**: `check_platform_gap` query is a single
`WHERE owner_id = ? AND platform = ? AND scheduled_at IS NOT NULL` plus the
time-range clause. No status enum plumbing.

## 5. Error shape on series-create atomic abort

**Decision**: Reuse the FR-011 single-post conflict shape and short-circuit
on the first detected conflict (existing post OR earlier sibling within the
would-be series).

**Source**: Clarify-Q3 → option A.

**Implementation implication**: one HTTPException factory shared by
`POST /api/posts`, `PATCH /api/posts/{id}`, and `POST /api/series`. The
frontend has one error-handling code path.

## 6. Cadence units and post_count bounds

**Decision**: `cadence_unit in {"days", "weeks"}`, `cadence_interval in [1, 30]`,
`post_count in [1, 20]`. Pydantic `Literal` + `Field(ge=..., le=...)`.

**Rationale**: Daily and weekly cadences are the only ones
`REQUIREMENTS.md` implies ("daily or weekly"). Monthly and custom recurrence
are out of scope. Post count upper bound prevents accidental DOS on
bulk-create. Lower bound of 1 covers the degenerate "single-post series"
case which is harmless.

**Timezone**: UTC on the wire. The existing `DateTime(timezone=True)` column
and `datetime` round-trip through Pydantic handle this.

## 7. Cascade delete vs. orphan on series deletion

**Decision**: Cascade — delete the series, delete its posts.
SQLAlchemy `cascade="all, delete-orphan"` on the `Series.posts` relationship.

**Rationale**: matches the "delete the plan, delete the plan's artifacts"
mental model. Keeps v1 simple (no orphaned-post cleanup path). If a user
wants to keep individual posts, they should delete just the posts
individually or delete the series after first cloning.

**Alternative considered**: null-out `series_id` (orphan). Rejected: makes
the feature UX confusing ("I deleted my series but the posts are still
polluting my list") and adds a UI decision we don't need to make.

## 8. Series edit scope

**Decision**: `PATCH /api/series/{id}` MUST only mutate `title` and
`description`. Cadence, platform, `start_at`, `post_count` are immutable.

**Rationale**: re-scheduling an existing series would require either
recomputing every post's `scheduled_at` and re-running the invariant
(complex and error-prone) or refusing the edit mid-way. Since the workflow
for "replan" is delete + recreate (Clarifications Q1 rationale), immutable
is the right default.

## 9. What the backend does with `status` on generated series posts

**Decision**: Generated posts default to `status = "scheduled"`.

**Rationale**: the creator has explicitly chosen a timestamp by setting
`start_at` + cadence; treating those as scheduled is the natural
interpretation. The single-post create path continues to default to
`"draft"` for any post created without a `scheduled_at`.

## 10. Bulk path's invariant check order

**Decision**: For `POST /api/series`:

1. Compute all N `scheduled_at` values from cadence math.
2. **Sibling precheck** — pairwise check the N values: any two within 15
   min on the same platform → 409 short-circuit. (In practice our cadence
   bounds prevent this, but the defensive check costs nothing.)
3. **DB precheck** — for each of the N, run `check_platform_gap` against
   the DB (no posts from this unsaved series are in the DB yet, so no
   self-exclusion needed). First conflict → 409.
4. If all N pass, open one transaction: insert the series row, then insert
   all N `Post` rows with their `series_id` / `series_position` set. Commit.
5. If the commit raises (unlikely but possible), rollback; return 500.

**Alternative considered**: Do the check inside the transaction with
`SELECT ... FOR UPDATE`. Rejected: SQLite's locking makes this overkill and
the two-phase check-then-write pattern is plenty for single-writer dev DBs.
If we ever migrate to Postgres, revisit.

## 11. Seed script extension (optional)

**Decision**: If time permits, extend `backend/scripts/seed_data.py` to
create one example series per seeded user (a weekly 4-post "Launch Campaign"
on a random platform). Otherwise, skip — the seed script already creates
20+ posts per user which demo the UI adequately.

**Rationale**: Nice-to-have for reviewer visual appeal; not load-bearing.
Constitution Principle I allowed edits within this feature's scope (the
"no-touch `scripts/seed_data.py`" directive was scoped to `001-docker-compose`).

## 12. Frontend component approach

**Decision**: Plain React function components with `useState` / `useEffect`,
same pattern as existing `PostsList.jsx` / `PostEdit.jsx`. No state-management
library, no form library, no UI kit.

**Rationale**: Principle II — stay on the existing stack. The existing pages
already demonstrate a readable pattern for small forms and tables. A new
library would cost ~15 min to wire up and 0 reviewer value.

## 13. Cadence preview UX

**Decision**: Compute the N post timestamps **on the client** in
`SeriesEdit.jsx` as the user types cadence/start/count. Render them under
the form before submit. No extra "preview" endpoint on the backend.

**Rationale**: Cadence math is trivial (`start + i * interval * unit`);
duplicating it on the client saves a round-trip and the form stays
responsive. The server is still authoritative — it recomputes on submit.

## Open questions

None. Principle VI check at the pre-plan gate found no new items.
