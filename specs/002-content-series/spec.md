# Feature Specification: Content Series

**Feature Branch**: `002-content-series`
**Created**: 2026-04-22
**Status**: Draft
**Input**: User description: "read the requirements.md and also the thing in the plan folder. We want to have the scheduler in this. Please be aware of any db schema update as well."

## Clarifications

### Session 2026-04-22 (pre-spec, per Constitution Principle VI)

Raised during `/speckit-specify` before any spec content was written.
Source question file: [`../../questions/002-content-series-pre-spec.md`](../../questions/002-content-series-pre-spec.md).
Source answer file: [`../../questions/002-content-series-pre-spec-answers.md`](../../questions/002-content-series-pre-spec-answers.md).

- Q: What does "have the scheduler in this" mean — build a real background publisher, or just the series + invariant scheduling? → **A: Series-only scheduling.** Materialize N posts from a series with correct `scheduled_at` values, enforce the 15-min same-platform rule, do not publish anything. `status` remains a passive label. No background worker. Matches the `plan/` folder scope and respects Constitution Principle II.
- Q: How should the DB schema changes (new `series` table + two new nullable columns on `posts`) roll out to reviewers who already have a populated `backend/scheduler.db`? → **A: Idempotent ALTER on startup.** After `Base.metadata.create_all`, guard an `ALTER TABLE posts ADD COLUMN ...` with a `PRAGMA table_info` existence check so re-runs are no-ops. No new dependencies, preserves existing seeded data, no reset step required by the reviewer.

### Session 2026-04-22 (during /speckit-clarify)

- Q: Can `PATCH /api/posts/{id}` mutate `series_id` or `series_position`? → **A: No — series membership is immutable via the single-post update endpoint.** Series membership is write-once from `POST /api/series`. Re-planning requires delete-series + create-new-series. Rationale: stays within the explicitly out-of-scope boundary the plan already drew around "moving a post into a series", keeps the existing `PostUpdate` schema and the existing `PostEdit.jsx` frontend component untouched, and avoids edge cases like a post whose `series_position` no longer matches its new series' cadence.
- Q: Which posts count toward the 15-minute same-platform conflict check? → **A: All posts with a non-null `scheduled_at` on the same platform for the same owner, regardless of `status`.** Drafts (`scheduled_at IS NULL`) are naturally exempt per FR-012. Rationale: matches the literal phrasing in `REQUIREMENTS.md` ("posts on the same platform can't be scheduled within 15 minutes of each other" — no status qualifier), keeps the query trivial (one `WHERE scheduled_at IS NOT NULL AND platform = ? AND owner_id = ?` clause), and avoids the bug class where changing a post's status accidentally unblocks a conflict elsewhere.
- Q: On `POST /api/series` atomic abort, what should the error response look like? → **A: Reuse FR-011's single-post shape, reporting the first conflict only.** Same JSON body structure (human message + `conflict_with_post_id`, `conflict_with_scheduled_at`, `delta_minutes`); short-circuit on the first collision detected (existing post **or** an earlier sibling within the would-be series). Rationale: frontend needs only one error-handling code path for both single-post and series-create paths (fits the timebox), it is computationally cheaper (short-circuit), and "first conflict wins" is the standard 409 idiom — the user resolves it and retries, and any remaining conflicts surface on the next submit.
- Q: How should each of the N generated posts in a series be titled? → **A: Auto-generate `"{series.title} — part {i+1}"` (1-indexed for human readability).** Creators can rename individual posts later via the existing `PATCH /api/posts/{id}` endpoint and `PostEdit.jsx` page. Rationale: respects the 3-hour timebox (zero new form UI for per-post titles), satisfies `Post.title NOT NULL` cleanly without "Untitled" placeholders that demand follow-up cleanup, and lets a creator iteratively refine titles using tools already present.
- Q: How should `DELETE /api/series/{id}` behave when the series contains posts with `status='published'`? → **A: Unconditional cascade — delete all posts regardless of status (v1).** `status='published'` is a cosmetic label in this MVP (no real publisher). Production follow-up (out of scope v1): switch to Option B — detach published posts (`series_id = NULL`) before cascading the remaining scheduled/draft posts, so history is preserved. That upgrade also needs a `posts.series_id` index, a migration to Postgres for row-level locking, SERIALIZABLE transaction isolation to guard the concurrent publisher race, and an async-queue offload of platform-side cancellation calls. All of that is documented as follow-up and is NOT in this feature's scope.
- Q: Should `start_at` in the past be accepted on `POST /api/series`? → **A: Yes — allow any datetime, no past-guard.** Matches the existing `POST /api/posts` which already accepts historical datetimes, so behavior stays consistent across APIs without arbitrary differences. Protects the 3-hour timebox (zero new validation, zero new failure-path tests). The 15-minute invariant check uses strict boundary comparisons and is time-agnostic, so past dates open no new safety hole. Supports the legitimate use case of backfilling a campaign that already started.
- Q: Can `PATCH /api/posts/{id}` change `platform` on a post that belongs to a series? → **A: No — reject with 409/400 if `series_id IS NOT NULL` and the request mutates `platform`.** Standalone posts can still change platform freely. Rationale: preserves FR-005's "platform is immutable after series creation" through the backdoor (otherwise a user could cascade a platform change via a child post, which is the exact backdoor FR-005 forbids), avoids the complex "re-run invariant for every sibling" path research.md §10 already rejected, prevents the cognitive dissonance of a Series showing `platform: instagram` while its posts are on different platforms, and trains the creator on the established "re-plan = delete + create" workflow. Future v2 (multi-platform series) would relax this; out of scope today.
- Q: When a series is renamed via `PATCH /api/series/{id}`, do its existing posts' auto-generated titles update? → **A: No — titles are frozen at creation.** Series PATCH updates only the series row; existing post titles keep whatever string they were created with (including any manual per-post edits the creator made afterward). Rationale: creators routinely rename individual posts after series creation (that is the entire point of per-post editability); cascading a series rename would clobber those edits. The "cascade only for posts that still have the original auto-generated title" refinement (option C) is explicitly deferred to v2 if time permits.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a scheduled content series (Priority: P1)

A creator plans a launch campaign by filling in one form: title, platform,
starting date/time, cadence (e.g., every 3 days), and number of posts. The
system materializes the full set of posts on the declared schedule so the
creator can open each one and refine its title/body. Posts that would
violate the 15-minute same-platform rule against each other or against
existing posts are rejected before any row is written.

**Why this priority**: This is the entire point of the feature — without
series creation there is nothing to demo or test. It must land first.

**Independent Test**: Log in as a seeded user, open the Series page, fill
the form with a 4-post weekly series on Instagram starting next Monday
9:00. Submit. Confirm the Series list now shows the series and that
four posts (scheduled exactly 7 days apart) appear in the Posts list and
Calendar, each tagged with the series.

**Acceptance Scenarios**:

1. **Given** an authenticated creator with no existing series, **When** they submit a valid series form (title, platform, start date, cadence, post count ≤ 20), **Then** the system creates one series and exactly N posts with `scheduled_at` values computed from the cadence, and the response surfaces the series id and the created post ids.
2. **Given** an existing post on the same platform 10 minutes before the series' first `scheduled_at`, **When** the creator submits the series, **Then** the system rejects the request with a 4xx error identifying the conflicting existing post, and **no** series row and **no** posts are persisted (atomic abort).
3. **Given** two series whose generated posts would overlap within 15 minutes on the same platform, **When** the second series is submitted, **Then** the same atomic-abort behavior applies.
4. **Given** a creator submits a series with `post_count = 0` or `post_count > 20`, **When** the form is submitted, **Then** validation rejects it with a clear error before any writes.

---

### User Story 2 - Enforce the 15-minute same-platform invariant on ALL post writes (Priority: P1)

The scheduling rule applies not just to series creation but to every path
that creates or updates a post's `scheduled_at`. Today, a creator (or a
direct API consumer) can schedule two posts on the same platform at the
same second. That MUST fail.

**Why this priority**: This is the assignment's one hard constraint and
Constitution Principle III (NON-NEGOTIABLE). It also underpins Story 1's
acceptance scenarios 2 and 3. Shipping Story 1 without this is shipping a
silently-broken feature.

**Independent Test**: `POST /api/posts` twice with the same platform and
`scheduled_at` 10 minutes apart — second call returns 4xx. Then `POST
/api/posts` twice exactly 15 minutes apart on the same platform — both
accepted. Then `POST /api/posts` twice same time, different platforms —
both accepted.

**Acceptance Scenarios**:

1. **Given** an existing scheduled post at T on platform P, **When** the creator tries to create another post at T+10min on P, **Then** the server rejects with 4xx and a message that identifies the conflicting post and time.
2. **Given** an existing scheduled post at T on platform P, **When** the creator creates another at exactly T+15min on P, **Then** the post is accepted (the boundary is inclusive on the safe side).
3. **Given** an existing scheduled post at T on platform P, **When** the creator creates another at T on a different platform Q, **Then** both are accepted.
4. **Given** a creator updates an existing post's `scheduled_at`, **When** the new time would conflict with a different post on the same platform, **Then** the update is rejected.
5. **Given** a creator updates a post but does not change its `scheduled_at`, **When** the update is submitted, **Then** the post does not conflict with itself (self-exclusion holds).

---

### User Story 3 - Browse and manage series (Priority: P2)

The creator can see a list of their series, open any one to view its
generated posts, edit cosmetic metadata (title/description), and delete
the series if they decide to abandon the plan. Deleting a series also
removes the posts it generated.

**Why this priority**: Without this the creator can create series but not
inspect or retract them — awkward but not fatal. P1 stories are enough
for an MVP.

**Independent Test**: After creating a series in Story 1, navigate to the
series detail page, confirm the N posts appear in `series_position`
order. Rename the series and confirm the rename sticks. Delete it and
confirm both the series row and its posts are gone.

**Acceptance Scenarios**:

1. **Given** the creator has one series with 4 posts, **When** they open the series detail view, **Then** they see the series metadata plus the 4 posts ordered by `series_position`.
2. **Given** the creator edits the series title, **When** they save, **Then** the title is updated and the cadence / posts are unaffected.
3. **Given** the creator deletes a series, **When** they confirm, **Then** the series row and all its posts are removed atomically.
4. **Given** one creator tries to view another creator's series by id, **When** the request is made, **Then** it is rejected as not found (ownership scoping).

---

### Edge Cases

- **Cadence too dense**: If the computed step between series posts is itself under 15 minutes (e.g., "every 10 minutes"), the series submission MUST fail before any write. In practice the allowed cadence units (days / weeks with interval ≥ 1) prevent this, but the check is still enforced defensively.
- **Null `scheduled_at`**: Draft posts with no scheduled time are exempt from the 15-minute rule (there is no time to compare).
- **Cross-user**: The 15-minute rule is scoped per owner. Two different creators can schedule posts on the same external platform at the same time — the app does not coordinate across owners.
- **Reschedule into a series**: Editing a post's `scheduled_at` (even one that belongs to a series) is still subject to the 15-minute rule. Editing series posts individually is allowed; the series cadence metadata is not auto-updated.
- **Delete a single post in a series**: Allowed. It creates a gap in `series_position` — the system tolerates this rather than renumbering.
- **Existing DB from the prior feature**: Reviewers already have a populated `scheduler.db` from the merged `001-docker-compose` feature. The schema rollout (Q2 answer) must preserve their data without a reset step.

## Requirements *(mandatory)*

### Functional Requirements

**Series lifecycle**

- **FR-001**: The system MUST allow an authenticated creator to create a series by supplying: title (required), optional description, single platform, `start_at` timestamp (any datetime — past, present, or future; no past-guard per Clarify-Q6), cadence (unit of days or weeks + interval ≥ 1), and post count (between 1 and 20 inclusive).
- **FR-002**: On series creation, the system MUST materialize exactly `post_count` posts whose `scheduled_at` values are `start_at + (i * cadence)` for `i` in `[0, post_count)`, stamped with the series id and a `series_position` integer starting at 0.
- **FR-002a**: Each generated post's `title` MUST be auto-set to `"{series.title} — part {i+1}"` (1-indexed). This guarantees a non-null, human-readable title without requiring the series form to collect per-post titles up front. Creators may rename individual posts after creation via the existing `PATCH /api/posts/{id}` path; series cadence / membership fields remain immutable per FR-005a.
- **FR-003**: The system MUST persist the series row and all its posts atomically. If any constraint check fails, **zero** rows are persisted (no partial writes).
- **FR-004**: The system MUST allow listing a creator's series (summary only — no embedded posts) and retrieving a single series with its posts ordered by `series_position`.
- **FR-005**: The system MUST allow editing a series' `title` and `description` only. Cadence, platform, `start_at`, and `post_count` are immutable after creation (v1 simplification). Renaming a series MUST NOT cascade to its existing posts' titles — those titles are frozen at creation time (FR-002a) and any post-create edits by the creator are preserved. Smart-cascade (update only posts whose titles still match the original auto-pattern) is a v2 consideration and is explicitly out of scope for v1.
- **FR-005a**: The single-post update endpoint MUST NOT mutate a post's series membership fields (series reference and position). Series membership is assigned once at series-create time and can only be removed by deleting the series itself. Attempts to modify those fields via the single-post update path MUST either be rejected or silently ignored (both are acceptable; consistency with existing `exclude_unset` patterns is preferred).
- **FR-005b**: The single-post update endpoint MUST reject any request that changes `platform` on a post whose `series_id IS NOT NULL`. Return a 4xx error naming the constraint ("series posts inherit the series' platform; re-planning requires delete + create a new series"). Standalone posts (`series_id IS NULL`) retain full freedom to change platform. This enforces the spec's single-platform-per-series assumption and closes the backdoor where a child post could mutate behavior FR-005 forbids at the series level.
- **FR-006**: The system MUST allow deleting a series. The delete MUST unconditionally cascade to every post that references it, regardless of the post's `status` (including `published`). v1 treats `published` as a cosmetic label; preservation of historical posts is a production concern documented as follow-up only.
- **FR-007**: All series endpoints MUST be scoped to the authenticated owner. A creator MUST NOT be able to read, update, or delete another creator's series (or its posts) via the series routes.

**Scheduling invariant (Constitution Principle III, NON-NEGOTIABLE)**

- **FR-008**: The system MUST reject any attempt to create or update a post whose `scheduled_at` falls strictly within 15 minutes of another existing post by the same owner on the same platform. The conflict set is defined as **every post with a non-null `scheduled_at` for that owner on that platform, regardless of `status`** (including `draft` with a time set, `scheduled`, `published`, and `failed`). Drafts without a `scheduled_at` remain exempt per FR-012.
- **FR-009**: Exactly 15 minutes apart on the same platform MUST be accepted (the boundary is inclusive on the safe side).
- **FR-010**: The 15-minute invariant MUST be enforced on the backend. Frontend-only validation is insufficient. It MUST apply to the single-post create endpoint, the single-post update endpoint, and the series-create endpoint.
- **FR-011**: When rejecting for the invariant, the response MUST include a clear human-readable message and machine-readable fields identifying the conflicting post id, the conflicting `scheduled_at`, and the delta in minutes. The same response shape MUST be used by the single-post create/update endpoints AND by the series-create endpoint. On series-create, the server MUST short-circuit on the **first** detected conflict (whether the counterpart is an existing post in the database or an earlier sibling in the would-be series) and MUST NOT return a list of all conflicts. On the series-create path, the body MAY additionally include `series_post_index` — the 0-indexed position within the would-be series of the post that triggered the conflict — so the UI can highlight "your post #N is the one that collides". This field MUST be absent on single-post conflict responses so the frontend can reliably switch on its presence.
- **FR-012**: Posts with `scheduled_at = null` (drafts) are exempt from the invariant and MUST always be accepted regardless of platform or other posts.
- **FR-013**: When updating an existing post, the invariant check MUST exclude that post from the conflict set (a post does not conflict with itself at its own current time).

**Data & schema evolution**

- **FR-014**: The system MUST add a new `series` entity to persistent storage with these fields: id, title, description (optional), platform, start_at, cadence_unit, cadence_interval, post_count, owner_id, created_at, updated_at.
- **FR-015**: The existing post entity MUST gain two nullable fields: a reference to its series and its position within that series. Posts that are not part of a series MUST continue to work with both fields null.
- **FR-016**: Schema changes MUST roll out to an existing populated database **without** requiring reviewers to delete `backend/scheduler.db` (per Clarifications Q2 answer C). Startup logic MUST detect missing columns and add them idempotently so repeated starts are no-ops.
- **FR-017**: The post response surface (what the frontend receives) MUST expose the series membership fields so the UI can display series context on each post.

**Surfaces**

- **FR-018**: The creator MUST be able to browse their series, create a new one, view a series' generated posts, edit series metadata, and delete a series from the frontend UI.
- **FR-018a**: Every new series-related frontend surface MUST honor Constitution Principle VII (User-Friendly UI Development). Concretely: (a) every asynchronous action (list fetch, submit, delete) MUST render a visible loading state; (b) every server-originated 4xx error MUST surface the server's `detail.message` verbatim — the UI MUST NOT substitute generic copy; (c) every list view MUST render an empty-state message with a call-to-action when the list is empty; (d) every destructive action (e.g., delete series) MUST require explicit user confirmation before firing; (e) every new page MUST be reachable from `Layout.jsx`'s nav bar — orphan routes are forbidden.
- **FR-019**: The existing Posts list and Calendar views MUST continue to work unchanged for posts that do not belong to a series. Posts that do belong to a series SHOULD surface their series membership (e.g., a badge or grouping).
- **FR-020**: The series creation form MUST preview the computed post timestamps before submission so the creator sees the schedule they are about to commit.

### Key Entities *(include if feature involves data)*

- **Series**: A creator's planned sequence of related posts on a single platform, published on a repeating cadence starting from a declared start date. Owned by exactly one user. Immutable cadence post-creation (v1).
- **Post (extended)**: The existing concept, now optionally tagged with the series it belongs to and its 0-indexed position within that series. Posts outside a series behave exactly as before.
- **Scheduling invariant**: The 15-minute same-platform same-owner gap rule that governs every write path touching `scheduled_at`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A creator can go from "no series" to a fully-populated 4-post weekly series in under 60 seconds from the series-create form on an already-running app.
- **SC-002**: 100% of same-platform scheduling-rule violations are rejected by the server with a 4xx error that names the conflicting post; zero partial writes on series-create failures.
- **SC-003**: A creator who already has a populated database from the prior feature can pull the new code and immediately use series without running any reset or migration command (per Clarifications Q2).
- **SC-004**: Deleting a series removes the series row and all its posts within the same request; subsequent reads return 404 for the series and its posts are no longer listed in Posts or Calendar.
- **SC-005**: All existing post-related tests continue to pass; the full automated test suite still runs under 5 minutes on CI.
- **SC-006**: A reviewer can open the PR and trace the Content Series feature end-to-end (model → schema → endpoint → UI) without guessing (Constitution Principle V).

## Assumptions

- The 15-minute same-platform rule is **per owner**, not global. Two different creators can independently schedule posts on the same external platform at the same time; the app does not coordinate across owners.
- Generated series posts default to `status = "scheduled"` because the creator has explicitly chosen a timestamp. Drafts are created by the single-post path only.
- Deleting a series cascades to its posts rather than orphaning them (`series_id = NULL`). This matches the natural "delete the plan, delete the plan's artifacts" mental model and keeps v1 simple.
- Only daily and weekly cadences are in scope for v1. Monthly and custom recurrence rules are follow-up work.
- One series owns one platform. Multi-platform series (same story scheduled to YouTube AND Instagram) are out of scope for v1 because the 15-minute rule is per-platform and multi-platform adds collision complexity.
- The existing non-Docker workflow (`uvicorn` + `npm run dev`) and the Docker Compose workflow both continue to work unchanged. This feature does not change infrastructure.
- Python lint (Ruff) remains deferred per the prior feature's FR-012c; no new Python linter is introduced by this feature.
- The two legacy `frontend/src/context/AuthContext.jsx` ESLint warnings carried over from the prior feature remain warn-level; this feature does not fix them.
- Reviewers may still optionally reset the DB (`rm -f backend/scheduler.db`) if they want a clean state, but they are not required to do so.
