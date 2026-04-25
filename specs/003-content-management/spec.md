# Feature Specification: Content Management (003 upgrade)

**Feature Branch**: `003-content-management`
**Created**: 2026-04-22
**Status**: Draft
**Input**: User description: "@plan/frontend-integration.md" — integrate the
external frontend reference at
`/Users/yuxuanhu/Desktop/takehome/Creator-Content-Management/` (CCM), enforce
the 15-minute rule on both frontend and backend, apply the lifecycle /
archival rules from `plan/series-and-post-delete-rules.md`, and update the
DB + API to match the CCM data shape.

## Clarifications

### Session 2026-04-22 (pre-spec, per Constitution Principle VI)

Raised during `/speckit-specify` before any spec content was written. Source
files: [`../../questions/003-frontend-integration-pre-spec.md`](../../questions/003-frontend-integration-pre-spec.md)
and [`../../questions/003-frontend-integration-pre-spec-answer.md`](../../questions/003-frontend-integration-pre-spec-answer.md).

- Q: How should I read the design? → **A: Read CCM at
  `/Users/yuxuanhu/Desktop/takehome/Creator-Content-Management/` as the
  reference implementation; port its features into the existing Vite
  `frontend/` (Principle II — no stack swap).**
- Q: "Create new post under an existing series"? → **A: Not enabled. 002
  FR-005 / FR-005a immutability stands; series membership is write-once;
  post_count fixed at creation.**
- Q: What does "update content per post" mean? → **A: Option D — keep
  platform lock per-post (see Q7 note on multi-platform series), AND add
  a `body` text column on `Post` for the actual post content; also
  surface `author` and `published_url` as read-only on the response
  shape to match CCM.**
- Q: Do ARCHIVED posts count toward the 15-min invariant? → **A: No.
  Archiving frees the slot; the check excludes `status = 'archived'`.**
- Q: Recovery UX for ARCHIVED? → **A: "Show archived" toggle on the
  list views + an "Unarchive" button that restores `previous_status`.
  Add a `previous_status` nullable column on `Post` (and optionally on
  `Series`).**
- Q: Replace 002 pages, add a new dashboard alongside, or hybrid? → **A:
  The CCM reference is the source of truth. Port its components into
  the existing Vite `frontend/` under new pages/components; existing
  001 + 002 routes remain accessible until explicitly replaced.**
- Q: Series creation UX and cadence? → **A: Fixed 4-stage template —
  Teaser → Announcement → Follow-up → Reminder. Stage labels are
  read-only for the user. Each stage has its own platform, title,
  body, and scheduled time (date + time), filled in manually — the
  time fields are NOT pre-populated. A 15-minute rule reminder banner
  is pinned at the top of the creation flow. The per-stage platforms
  MAY differ within the same series (CCM sample data shows multi-
  platform series), which supersedes 002's FR-005 (single-platform-per-series) and FR-005b (platform-immutable-on-series-posts) clauses. Both of those 002 rules are explicitly relaxed in 003.**
- Q: Rules filename was misreferenced. → **A: Renamed to
  `plan/series-and-post-delete-rules.md` (single dash); reference in
  `plan/frontend-integration.md` updated.**

### Session 2026-04-22 (during /speckit-clarify)

- Q: For series-level destructive flows, does the rules-doc `Archive Series` workflow win, or does CCM's current `Delete` + `Cancel Remaining` pair win? → **A: Rules doc wins (option B).** Implement `DELETE /api/v1/series/{id}` with a guard that returns 4xx when ≥1 child post has `status = "published"`, plus `POST /api/v1/series/{id}/archive` that archives the series + archives every published post + archives every unexecuted (`draft`/`scheduled`) post per rules-doc §5B. CCM's `requestCancelSeries` flow is updated during the port to route to the new archive endpoint for in-progress series; hard delete remains available for pre-execution series only. A separate "Cancel Remaining (retain published)" flow MAY coexist as an additional softer action but is not required by the spec.
- Q: Do we keep the Sequential Integrity rule (rules-doc §2: series posts strictly time-ordered by position) even though CCM doesn't check it client-side? → **A: Keep FR-020 AND add the client-side pre-check to the ported SeriesBuilder.** Backend and frontend both enforce; rules-doc §2 is honored; CCM gains the missing check. The 15-minute invariant (FR-018/019) continues to apply on top of Sequential Integrity — both rules hold simultaneously.
- Q: What does the `author` field mean given the single-user auth model? → **A: Single-user model preserved. `author` is DERIVED from the logged-in user's `full_name` at read time, not stored as a column.** CCM sample data showing multiple author names within one account is cosmetic and does not imply team/sharing support. All posts and series belong to exactly one user (the authenticated owner via `owner_id`, which is unchanged from 001/002). No multi-user, no sharing, no team features are introduced in this upgrade.
- Q: How should archived items appear in the list vs calendar views? → **A: List always shows archived (faded styling, "archived" label) to match CCM's inline archival visual; Calendar hides archived by default (scheduling contexts are forward-looking).** No "Show archived" toggle is added to the list. The API exposes an `include_archived=true|false` query parameter; the ported ListView sends `true`, CalendarView sends `false`. Users who want to see archived events on the calendar can open the corresponding list entry.
- Q: Do we keep `canceled` as a distinct post status alongside `archived`? → **A: No — drop `canceled` from the status enum.** The enum is: `draft, scheduled, published, failed, archived`. Clarify-Q1 adopted the rules-doc archive flow as the only series-level destructive path that touches unexecuted posts; `canceled` would create a second terminal state with no functional distinction from `archived`. CCM's existing `requestCancelSeries` callback is re-routed during the port to call the Archive-Series endpoint (FR-017), flipping unexecuted posts to `archived`. Any CCM UI copy mentioning "cancel" is updated to "archive" to match the single terminal vocabulary.

### Session 2026-04-22 (during /speckit-plan re-run)

- Q: Structural shape of the new frontend — should new components live under a suffixed subdirectory with a suffixed top-level page, or directly in `frontend/src/components/` with a single `Dashboard.jsx`? → **A: Directly in `frontend/src/components/` with `pages/Dashboard.jsx`; no version-suffix subdirectory.** The 6 legacy 002 pages are DELETED (not de-routed) since the backend contract they called is replaced in the same PR. Rationale: the 003 upgrade IS the app now; suffixes/subtrees would imply a coexistent prior surface that no longer exists.
- Q: API versioning — keep mixed paths (`/api/...` for 001/002 endpoints + `/api/v1/series/v2` for the new create) or unify everything under `/api/v1`? → **A: Unify everything under `/api/v1`.** All three routers (`auth`, `posts`, `series`) mount with `prefix="/api/v1"` in `backend/app/main.py`. `frontend/src/api/client.js` `API_BASE` default becomes `http://localhost:8000/api/v1`. 001/002 tests are path-rebased in the same PR (single find-and-replace). The series-create endpoint is `POST /api/v1/series` with the new 4-stage body — the 002 cadence-based body shape is RETIRED, not coexistent, because the frontend (its only caller) is rewritten in the same PR.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Create a series from the fixed 4-stage template (Priority: P1)

A creator opens "New series", sees the template locked to Teaser →
Announcement → Follow-up → Reminder, and fills in each stage's
platform, title, body, date, and time. The 15-minute rule banner is
visible at the top throughout. On submit the system creates one series
and exactly four posts atomically; if any stage would violate the
15-minute rule or the stages are not strictly time-ordered, the submit
is blocked with the offending stages highlighted.

**Why this priority**: it is the primary user-facing story of the 003 upgrade. Without it the
"take user experience into consideration" goal isn't delivered.

**Independent Test**: Open the app, click "New series", confirm the
four stage blocks show with locked stage labels. Fill each with a
title + body + platform + a future date/time at least 15 min apart
from everything else. Submit. The series appears in the list; the
four posts appear individually in the posts list / calendar.

**Acceptance Scenarios**:

1. **Given** an authenticated creator with no existing series, **When**
   they submit a valid 4-stage series form, **Then** one series and
   four posts (one per stage, in order) are created atomically and
   each post has the correct stage label, a per-stage platform, the
   user's title/body, and the user's chosen `scheduled_at`.
2. **Given** two stages that would fall within 15 minutes of each
   other on the same platform, **When** the creator submits, **Then**
   the submit is blocked client-side with both stages highlighted,
   AND — if it somehow reaches the backend — the server rejects
   atomically with zero rows written.
3. **Given** Teaser is scheduled at `T` and Announcement is scheduled
   at `T − 1h`, **When** the creator submits, **Then** the submit is
   blocked because stages MUST be strictly time-ordered by position
   (Sequential Integrity rule).
4. **Given** a creator leaves a stage's title or date/time blank,
   **When** they attempt to submit, **Then** the submit is blocked
   client-side with the incomplete stage highlighted.
5. **Given** the form is open, **When** the creator scrolls, **Then**
   the 15-minute rule reminder banner stays visible at the top.

---

### User Story 2 — Enforce the 15-minute invariant on every write path, on both frontend and backend (Priority: P1)

Every client-side form that writes a `scheduled_at` checks the
15-minute rule before enabling the submit button and highlights
conflicts inline. Every backend write path (`POST /api/v1/posts`,
`PATCH /api/v1/posts/{id}`, the templated series-create endpoint)
independently re-checks the rule and rejects with a 4xx when
violated. Archived posts are excluded from the conflict set.

**Why this priority**: Constitution Principle III NON-NEGOTIABLE +
the assignment's one hard constraint. 003 adds the client-side pre-
submit check and the ARCHIVED exclusion on top of 002's backend check.

**Independent Test**: Create an Instagram post at `T`. Open "New post",
pick Instagram, pick `T + 10min` — the submit button is disabled and
the form shows "Within 15 min of \<existing\>". Bypass the UI with a
direct `POST /api/v1/posts` — the server still returns 4xx. Archive the
`T` post; the `T + 10min` attempt now succeeds both client-side and
server-side.

**Acceptance Scenarios**:

1. **Given** an existing scheduled post on the same platform, **When**
   the user types a time within 15 minutes in any form, **Then** the
   form shows an inline conflict marker and the submit button is
   disabled or otherwise prevented.
2. **Given** the form is bypassed (direct API call), **When** the
   backend receives a scheduled_at within 15 minutes of another same-
   platform post by the same owner, **Then** the backend returns 4xx
   with the same `platform_gap_conflict` body shape as 002 FR-011 (so
   existing error handling continues to work).
3. **Given** an existing post is archived (`status = "archived"`),
   **When** a new post is scheduled within 15 minutes of it on the
   same platform, **Then** both the frontend and the backend accept
   the new post.
4. **Given** two posts on different platforms, **When** both are
   scheduled at the same time, **Then** both are accepted.
5. **Given** a creator updates an existing post's time, **When** the
   new time would conflict with a different post (excluding itself),
   **Then** both the frontend and the backend reject the update.

---

### User Story 3 — Delete behavior follows the Archival lifecycle rules (Priority: P1)

Post and series deletion paths are status-aware per
`plan/series-and-post-delete-rules.md`. Draft / scheduled / failed
posts hard-delete. Published posts can only be archived, not deleted.
A series whose posts are all pre-execution hard-deletes. A series with
at least one published post gets its series archived and its unexecuted
posts archived to preserve history.

**Why this priority**: protects historical truth (published posts
cannot be destroyed) and gives the user a safe retraction path.

**Independent Test**: Mark one post in a series as published. Attempt
to delete the series — the confirm dialog says "Archive Series" (not
"Delete"), and after confirm: the series row stays (marked archived),
the published post remains (status flips to archived), the unpublished
posts transition to archived. Meanwhile a fully-pre-execution
series lets you hard-delete normally.

**Acceptance Scenarios**:

1. **Given** an individual post with `status ∈ {draft, scheduled,
   failed}`, **When** the user confirms delete, **Then** the backend
   hard-deletes the post and the UI removes it immediately.
2. **Given** an individual post with `status = "published"`, **When**
   the user opens the row's menu, **Then** the action shown is
   "Archive" (not "Delete"); the backend rejects a `DELETE` request on
   a published post.
3. **Given** a series whose posts are all pre-execution (no post is
   `published`), **When** the user confirms "Delete series", **Then**
   the backend hard-deletes the series row and cascades hard-delete to
   its posts.
4. **Given** a series with at least one `published` post, **When** the
   user opens the series menu, **Then** the action shown is "Archive
   series" (not "Delete"); the backend marks the series archived, the
   `published` posts archived, and the unexecuted posts archived (so
   they will not fire).
5. **Given** an individual archive or series-archive action, **When**
   the creator later toggles "show archived" and clicks "Unarchive",
   **Then** the post/series is restored to its `previous_status`.

---

### User Story 4 — Update post content independently (Priority: P1)

A creator can open any post (standalone or series-child) and edit its
title, body, platform, and scheduled time. The 15-minute rule applies
to any change that affects platform or scheduled time.

**Why this priority**: "update content" is explicit in the 003 brief and
is the only sensible response to `Post.body` being NULL under 002.

**Acceptance Scenarios**:

1. **Given** a draft post, **When** the creator edits the `body` text
   and saves, **Then** the new body persists and is visible in the
   posts list.
2. **Given** a series-child post, **When** the creator edits its
   platform, **Then** the edit is accepted (003 relaxes 002's FR-005b); the series
   remains intact; the 15-min invariant is re-checked against the new
   platform.
3. **Given** any post is being edited, **When** the scheduled time is
   moved into another same-platform post's 15-min window, **Then**
   both the frontend and the backend reject the update.

---

### User Story 5 — Browse archived content and restore it (Priority: P2)

The **ListView** always displays archived posts and series inline
with distinctive faded styling plus an explicit `archived` label and
an **Unarchive** action on each archived row. The **CalendarView**
hides archived items by default because it is a forward-scheduling
surface. Confirming **Unarchive** restores the item to its
`previous_status`. See Clarify-Q4 for the rationale behind the
per-view visibility split; no "Show archived" toggle is introduced.

**Why this priority**: supports the "can recover" promise from the
`frontend-integration.md` doc (Q5 answer B).

**Acceptance Scenarios**:

1. **Given** at least one archived post exists, **When** the user
   opens the posts list, **Then** the archived post renders inline
   with faded styling, an explicit `archived` label, and an
   **Unarchive** action — no toggle interaction is required
   (Clarify-Q4).
2. **Given** the user clicks **Unarchive** on an archived post,
   **When** they confirm in the `ConfirmModal`, **Then** the post's
   status reverts to its `previous_status` and the row loses the
   archived styling on the next list fetch.
3. **Given** at least one archived post exists, **When** the user
   opens the calendar view, **Then** the archived post is NOT
   rendered (CalendarView sends `include_archived=false` per
   FR-025).

---

### Edge Cases

- **Legacy 002 series (generic cadence, no stage labels)** still in the
  DB: they remain readable and their posts render without a stage; the
  003 creation flow does not produce new ones.
- **Attempting to create a new templated series with a past `scheduled_at`** on
  any stage: allowed (Clarify-Q6 from 002 carries forward).
- **Attempting a templated series where stage N's platform matches an
  existing archived post's platform in its 15-min window**: allowed,
  because archived posts are excluded from the conflict set (Q4).
- **Client-side 15-min check drift from server time**: the client uses
  the user's local timezone to compute the ISO timestamp it sends;
  the server uses UTC for all comparisons. All stored times are
  UTC-normalized (see 002 `scheduling.py`).
- **Reviewer with an existing 002 DB**: schema additions roll out via
  an idempotent `ALTER TABLE ... ADD COLUMN` block in `init_db`
  (matches 002's FR-016 pattern). No reset step required.
- **Series-level delete confirmation** must use wording consistent
  with the single terminal state adopted in Clarify-Q5, e.g.:
  *"This series is already in progress. Future posts will be
  archived (not canceled), along with the published history, so
  the full timeline is preserved."* Earlier rule-doc phrasing using
  "canceled" is superseded by the 003 terminology ("archived").
- **Posts with no `body`** (legacy rows inserted under 002): the body
  column is nullable; the UI shows an empty-state placeholder in the
  body area rather than a blank cell.

## Requirements *(mandatory)*

### Functional Requirements

**Series lifecycle**

- **FR-001**: The frontend MUST expose a "New series" action that
  opens a modal showing the fixed 4-stage template. The stage labels
  (Teaser, Announcement, Follow-up, Reminder) MUST be read-only and
  visually indicated as locked.
- **FR-002**: The form MUST collect, per stage, `platform`, `title`,
  `body`, `date` (YYYY-MM-DD), and `time` (HH:mm). Schedule fields
  MUST NOT be pre-populated.
- **FR-003**: The form MUST render a 15-minute rule reminder banner
  pinned at the top of the modal body so it remains visible while the
  user scrolls through the stages.
- **FR-004**: On submit, the frontend MUST pre-validate all four
  stages: (a) each stage has a non-empty title, (b) each has a valid
  date+time, (c) each stage's computed `scheduled_at` passes the
  15-minute check against every other post in the user's universe
  (existing posts + sibling stages), (d) stages are strictly time-
  ordered by position (Sequential Integrity). If any check fails, the
  submit MUST be blocked and offending stages highlighted.
- **FR-005**: The backend MUST expose an endpoint that atomically
  creates one `Series` row and four `Post` rows with the user's
  platform/title/body/scheduled_at values and fixed stage labels. On
  any validation failure (15-min, Sequential Integrity, empty fields,
  bad platform) the backend MUST return 4xx with zero rows written.
- **FR-006**: Series posts MAY have different platforms within the
  same series. This explicitly supersedes 002's FR-005 (one-platform-
  per-series) and FR-005b (platform-immutable-on-series-posts)
  clauses — both are relaxed in 003. The
  `Series.platform` metadata column MAY be set to the Teaser stage's
  platform as a display hint but is no longer authoritative.
- **FR-007**: `Series.title` / `Series.description` remain editable
  via `PATCH /api/v1/series/{id}` per 002 FR-005. Cadence metadata
  columns (`cadence_unit`, `cadence_interval`, `post_count`,
  `start_at`) remain populated for legacy reasons but are not user-
  user-editable in 003.

**Post content**

- **FR-008**: The `Post` entity MUST gain a `body` text column
  (nullable, up to 5000 chars) to hold the post's main content. The
  `PostResponse` MUST expose it; `PostCreate` / `PostUpdate` MUST
  accept it.
- **FR-009**: The `Post` entity MUST gain a read-only `published_url`
  string column (nullable) so the frontend can display a "view
  original" affordance on published posts. The `author` display
  field shown in the UI MUST be derived at read time from the
  authenticated user's `full_name` (or `email` if `full_name` is
  null); NO `author` column is added. Single-user scope is preserved
  — every post belongs to exactly one user via the existing
  `owner_id` FK.
- **FR-010**: The `PostUpdate` endpoint MUST accept edits to
  `title`, `body`, `platform`, `scheduled_at`, and `status` on any
  post (standalone or series-child). 002's FR-005b "reject platform
  change on series posts" is SUPERSEDED in 003; the 15-min invariant
  remains the protection.

**Status enum and archival**

- **FR-011**: The `Post.status` enum MUST be expanded to include
  `archived` in addition to the existing `draft`, `scheduled`,
  `published`, `failed`. Final enum: `draft, scheduled, published,
  failed, archived`. The `canceled` value from CCM's sample code is
  NOT part of the enum (Clarify-Q5).
- **FR-012**: The `Post` entity MUST gain a `previous_status`
  nullable column. When a post is archived, the server MUST set
  `previous_status = <current status>` and then set `status =
  "archived"`. When un-archived, the server MUST restore `status =
  previous_status` and clear `previous_status`.
- **FR-013**: The `Series` entity MUST gain a `status` column with
  values `active` (default) or `archived`, plus a `previous_status`
  nullable column mirroring the post behavior.
- **FR-014**: `DELETE /api/v1/posts/{id}` MUST:
  - return 204 and hard-delete when the post's status is in
    {`draft`, `scheduled`, `failed`};
  - return 4xx (e.g., 409 with `{error: "published_requires_archive"}`)
    when the status is `published`;
  - the frontend MUST surface an "Archive" action for published posts
    in place of "Delete".
- **FR-015**: `POST /api/v1/posts/{id}/archive` MUST flip status to
  `archived` preserving `previous_status`. `POST /api/v1/posts/{id}/unarchive`
  MUST reverse the transition.
- **FR-016**: `DELETE /api/v1/series/{id}` MUST:
  - hard-delete the series and cascade hard-delete its posts when
    zero posts are `published`;
  - return 4xx when at least one post is `published`, with a body
    indicating the user should archive the series instead;
  - OR the endpoint MAY accept a `?mode=archive` query parameter that
    archives the series, archives its `published` posts, and archives
    its unexecuted posts. The frontend calls the right
    variant based on the rule-doc scenario.
- **FR-017**: `POST /api/v1/series/{id}/archive` MUST mark the series
  `archived`, archive every `published` post (flip status →
  archived, preserve previous_status), and archive every unexecuted
  post (`draft`/`scheduled` → archived). `POST /api/v1/series/{id}/unarchive`
  MUST reverse the transitions for the series and its posts.

**Scheduling invariant (Constitution Principle III, NON-NEGOTIABLE)**

- **FR-018**: The 15-minute invariant MUST exclude posts with
  `status = "archived"` from the conflict set (Clarify-Q4: archived
  posts free the slot).
- **FR-019**: The 15-minute invariant MUST be enforced on BOTH sides:
  the frontend disables submit and renders inline conflict markers
  when the rule is violated; the backend independently re-checks and
  returns 4xx on direct API writes. Neither side alone is sufficient.
- **FR-020**: Within a single series, the per-stage `scheduled_at`
  values MUST be strictly monotonically increasing by stage position
  (Sequential Integrity rule from the delete-rules doc §2). The
  frontend pre-checks; the backend re-checks on create and on
  updates that reschedule a series post.
- **FR-021**: The 409 response shape from 002 FR-011 (shared
  `platform_gap_conflict` body) remains the canonical shape for
  15-min conflicts. A new `error: "sequential_integrity_violation"`
  body is defined for Sequential Integrity failures, with
  `offending_post_id` and `prior_post_id` fields.

**Frontend integration and navigation**

- **FR-022**: The CCM reference implementation MUST be ported into
  `frontend/src/` as Vite-native React components (imports instead of
  `window.*` globals; Tailwind added as a `devDependency`; lucide
  brought in via `lucide-react`; `date-fns` already present). The HTML
  shell in `frontend/index.html` remains Vite's.
- **FR-023**: The ported app MUST include at least these views:
  List view with Standalone + Series groupings; Calendar view;
  New-post modal (`PostForm`); New-series modal (`SeriesBuilder`);
  Confirm modal (`ConfirmModal`). The six legacy 002 pages
  (`SeriesList`, `SeriesEdit`, `SeriesDetail`, `PostsList`,
  `CalendarPage`, `PostEdit`) are DELETED in the same PR (see the
  /speckit-plan re-run entry on frontend structure in
  Clarifications); `frontend/src/pages/Dashboard.jsx` is the only
  post/series surface after the port, and the Layout nav routes to
  it.
- **FR-024**: Every new surface added in 003 MUST honor Constitution Principle VII:
  loading states, error toasts surfacing `detail.message` verbatim,
  empty states with calls-to-action, and confirmation dialogs for
  destructive actions. The CCM `ConfirmModal` pattern is the template.
- **FR-025**: The ported **ListView** MUST display archived items
  inline by default, rendered with distinctive "faded" styling plus
  an explicit `archived` label and an **Unarchive** action. The ported
  **CalendarView** MUST hide archived items by default (forward-looking
  scheduling context). The backend list endpoint MUST accept an
  `include_archived=true|false` query parameter so each view can
  request the appropriate subset; the default when the param is
  omitted is `false` (archived excluded).

**API surface**

- **FR-026**: The backend MUST expose, at minimum, the following new
  or extended endpoints: `POST /api/v1/posts/{id}/archive`,
  `POST /api/v1/posts/{id}/unarchive`, `POST /api/v1/series/{id}/archive`,
  `POST /api/v1/series/{id}/unarchive`, and the templated
  series-create endpoint (`POST /api/v1/series`, which replaces the
  002 cadence-based body shape — the legacy shape is retired, not
  coexistent; see the /speckit-plan re-run entry on API versioning
  in Clarifications).
- **FR-027**: All response shapes MUST include the new post fields
  (`body`, `published_url`, `stage`, `previous_status`) as optional
  fields that are null on legacy rows. The `PostResponse` MUST also
  include a derived `author` field populated from
  `owner.full_name ?? owner.email` at read time.
- **FR-028**: The backend MUST serve through the existing JWT auth
  dependency (Principle II) and scope every list/read/write to the
  authenticated owner (002 FR-007 carries forward).

**Data & schema evolution**

- **FR-029**: Schema additions MUST roll out via the existing
  idempotent `ALTER TABLE ... ADD COLUMN` block in `init_db`, guarded
  by `PRAGMA table_info` so repeated starts are no-ops. No reviewer
  reset step required.
- **FR-030**: The seed script MUST continue to run cleanly on both a
  fresh DB and a DB that already contains 002 rows. It MAY be
  updated to populate the new fields for example data, but it MUST
  NOT require the new fields to be present on legacy rows.

### Key Entities *(include if feature involves data)*

- **Series (updated in 003)**: A creator-owned grouping of exactly four posts
  staged as Teaser → Announcement → Follow-up → Reminder. Has
  `id, name, description, color, owner_id, status,
  previous_status, created_at, updated_at`. Legacy cadence fields
  (`cadence_unit`, `cadence_interval`, `post_count`, `start_at`,
  `platform`) remain on the row for backwards compatibility but are
  no longer user inputs in 003.
- **Post (updated in 003)**: Existing `Post` entity plus new columns:
  `body` (text, nullable, ≤ 5000 chars),
  `published_url` (string, nullable),
  `stage` (string, nullable; set for series-child posts with values
  `Teaser | Announcement | Follow-up | Reminder`),
  `previous_status` (string, nullable).
  Status enum expanded: `draft | scheduled | published | failed |
  archived`. The `author` display field is NOT a column;
  it's derived at read time from `owner.full_name` (or `owner.email`
  if the full_name is null).
- **Archival action**: A logical transition that flips
  `status → archived` while recording `previous_status`, removes the
  record from active views, retains it in the DB, and excludes it
  from the 15-minute invariant. Reversible via the unarchive action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A creator can go from the home screen to a submitted
  4-stage series in under 2 minutes, including choosing platforms,
  titles, bodies, and times for each stage.
- **SC-002**: 100% of 15-min rule violations are caught on the client
  before submit AND rejected on the server if bypassed; zero silent
  rule violations in end-to-end tests.
- **SC-003**: 100% of `DELETE` requests against published posts are
  rejected by the backend with a 4xx that the UI converts into an
  "Archive" dialog.
- **SC-004**: A reviewer upgrading from 002 to 003 can pull code and
  run `docker compose up` without deleting `backend/scheduler.db`;
  the idempotent migration silently adds the new columns.
- **SC-005**: All existing 001 + 002 tests continue to pass (54
  backend tests + 22 frontend tests); 003 adds its own coverage for
  the new backend endpoints and the new frontend components per
  Constitution Principles IX + IV.
- **SC-006**: The ListView renders archived rows within 1 second of
  the list fetch completing on a DB with ≤ 500 posts. The
  CalendarView never displays archived items (FR-025). No "Show
  archived" toggle exists (Clarify-Q4).
- **SC-007**: A creator can archive a published post and later
  un-archive it, restoring the original `status` (`published`) in a
  single user action each way.

## Assumptions

- The CCM reference is the authoritative UI spec for 003. Where CCM and
  this spec disagree, this spec wins (the CCM is a reference, not a
  binding contract).
- The 003 frontend ships through the existing Vite + React toolchain;
  the CCM's CDN setup is NOT adopted (Principle II).
- Per-post platform independence within a series is intentional;
  legacy 002 callers that assumed "one series, one platform" must
  adapt. Existing 002 tests that encode `FR-005b` will be updated as
  part of 003 (grandfather clause on Principle IX for those specific
  tests — documented in the PR description).
- Soft-deleted content is never physically deleted by 003 code paths;
  a future "hard purge" operation is out of scope.
- Background publication is still out of scope; `status = "published"`
  remains a user-set label for now. 003 adds the `status = "archived"`
  preservation path so the platform readiness story is strictly better
  than 002's, not worse.
- The existing non-Docker workflow (`uvicorn` + `npm run dev`) and
  the Docker Compose workflow both continue to work unchanged. 003
  does not alter infrastructure.
- Frontend tests remain pragmatic (Principle IV); backend-API tests
  remain test-first (Principle IX) for any new endpoints (archive /
  unarchive, templated series-create, sequential-integrity check).
