# Feature Specification: Auto-Publish Flow & Status Transition Lockdown

**Feature Branch**: `006-auto-publish-flow`
**Created**: 2026-04-24
**Status**: Draft
**Input**: User description (see `scheduler-details/prompt.md`):

> Currently when a user schedules a post or a post under a series, we don't have a status-update mechanism such that the backend knows this post needs to be published, then updates the status to `published`, and notifies the frontend so that the UI status updates.
>
> Use APScheduler (Advanced Python Scheduler), specifically the AsyncIOScheduler. It runs directly inside the FastAPI event loop and should be a good option for simplicity.
>
> WE NEED THIS TO BE HAPPENED AS OUR FINAL STEPS.
>
> Also, having the user update post status to `failed` doesn't make sense — `failed` should only be applied when the backend fails to publish. Having the user update post status to `published` doesn't make sense — instead, we should have a "Publish post" button on the post edit form so that the user clicks it, the frontend sends a publish API call, the backend updates the post status, and the UI updates correspondingly.
>
> `failed` and `published` should be removed from the post-status dropdown.

This spec covers the missing status-transition machinery: the backend must drive the `scheduled → published` transition (both automatically at the scheduled time and on explicit manual request), and the user-facing form must stop offering `published` / `failed` as selectable values because those statuses are server-controlled outcomes, not user inputs.

---

## Clarifications

### Session 2026-04-24

- Q: For a series with 4 stages, should each stage auto-publish independently when its own `scheduled_at` arrives, or should later stages depend on earlier ones reaching `published`? → A: Sequential — stage N auto-publishes only after stage N-1 is in `published`. If an earlier stage is archived, failed, or otherwise not `published`, later stages skip auto-publish (they remain in `scheduled` and require manual intervention).
- Q: Should the "Publish post" action require explicit confirmation, or publish on a single click? → A: Confirmation modal — the user must acknowledge a "Publish this post now? This cannot be undone." prompt before the publish commits. Cancel returns to the form unchanged.
- Q: When an auto-publish attempt fails internally (e.g., transient DB error during the status flip), what should happen? → A: Leave the post in `scheduled` and rely on the existing catch-up sweep (FR-003) to retry on the next tick / restart. `failed` remains reserved for external-platform failures. Critically, the user MUST be made aware of the failure — the post is annotated with a "last publish attempt failed; will retry" surface (visible in the post edit form and in list / track views) so the creator knows something needs attention. Once a subsequent attempt succeeds, the failure annotation clears.
- Q: How tight should the auto-publish freshness SLO be? → A: Keep the original 60-second UI-freshness target and 30-second restart catch-up. Polling-based propagation is sufficient for the use case; no move to SSE / WebSockets or to sub-10-second targets. Real-time push remains explicitly Out of Scope.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scheduled posts publish themselves at the right time (Priority: P1)

A creator schedules a post for 2:00 PM on Tuesday. They close their laptop. At 2:00 PM, the platform's backend recognizes the time has arrived and transitions the post from `scheduled` to `published` without any human action. The next time anyone opens the dashboard (or has it open already), they see the post listed as published — same as if a human had clicked a "publish" button at 2:00 PM.

**Why this priority**: This is the most load-bearing missing piece. Today, scheduled posts sit in `scheduled` forever — the system advertises a scheduling feature it doesn't actually fulfill. Without auto-publish, every other piece of the product (calendar, train-track, dashboard counts of "published last 7 days") is reasoning over a status that never changes on its own. Fixing this closes the loop the assignment implied.

**Independent Test**: Schedule a post for 60 seconds in the future on a clean dataset; wait; confirm via the API and the dashboard UI that its status is `published` and that the dashboard "Published 7D" count incremented. Restart the backend mid-wait and confirm the publish still occurs.

**Acceptance Scenarios**:

1. **Given** a post with `status = scheduled` and `scheduled_at` set to 30 seconds from now, **When** the scheduled time elapses, **Then** the post's status becomes `published` without any frontend or human action.
2. **Given** a scheduled post whose `scheduled_at` is already in the past at the moment the backend starts, **When** the backend completes startup, **Then** the post is published within the catch-up window (≤30 seconds of startup).
3. **Given** an open dashboard tab with the post visible as `scheduled`, **When** the auto-publish fires, **Then** the dashboard reflects the new `published` status without a manual page reload (within the polling cadence of ≤60 seconds).
4. **Given** a post is rescheduled from `2:00 PM` to `4:00 PM`, **When** 2:00 PM passes, **Then** the post is *not* published (the trigger has been re-armed for 4:00 PM).
5. **Given** a scheduled post is archived before its scheduled time, **When** the scheduled time elapses, **Then** the post stays `archived` (the trigger has been cancelled, not re-armed).
6. **Given** a series with 4 stages where stage 1 is `published` and stages 2/3/4 are `scheduled`, **When** stage 2's `scheduled_at` elapses, **Then** stage 2 auto-publishes (because its predecessor is `published`).
7. **Given** a series where stage 1 is `archived` (was never published) and stages 2/3/4 are `scheduled`, **When** stage 2's `scheduled_at` elapses, **Then** stage 2 does NOT auto-publish — it remains `scheduled` because its predecessor never reached `published`. Stages 3 and 4 likewise stall in `scheduled` when their times arrive.

---

### User Story 2 - Creator can publish a post on demand (Priority: P2)

A creator finishes a draft and wants it live now, not at some scheduled future time. They open the post in the edit form and click a clearly labeled "Publish post" button. Within a couple of seconds the post is marked as `published` and the UI reflects that immediately — the button disappears (or becomes disabled), the status badge flips from `draft`/`scheduled` to `published`, and any list / calendar / track view they navigate to shows the new state.

**Why this priority**: Even with auto-publish in place, the user explicitly asked for an on-demand publish path. It also serves as the only way to publish a draft (drafts have no `scheduled_at`, so auto-publish never fires for them). This is the second-most load-bearing piece: it gives the creator a deliberate "ship it now" affordance.

**Independent Test**: Open a `draft` or `scheduled` post in the edit form; click "Publish post"; confirm the post's status reads `published` in the form, in the list view, and via the API within 2 seconds of the click.

**Acceptance Scenarios**:

1. **Given** a post in `draft` status open in the edit form, **When** the creator clicks "Publish post", **Then** the post's status becomes `published` and the UI updates in place (no full reload required).
2. **Given** a post in `scheduled` status, **When** "Publish post" is clicked, **Then** the post is published immediately, and the auto-publish trigger that would have fired at the scheduled time is cancelled (it does not double-fire).
3. **Given** a post that is already `published`, `failed`, or `archived`, **When** the edit form opens, **Then** the "Publish post" button is not shown (it has no valid target).
4. **Given** the creator double-clicks "Publish post", **When** the second request lands, **Then** the second request is a no-op (the status is already `published`) and the user sees no error toast.
5. **Given** the creator clicks "Publish post", **When** the confirmation prompt appears, **Then** the post is NOT yet published; the user must confirm explicitly. Choosing Cancel returns to the form with no state change.
6. **Given** the creator confirms the publish prompt, **When** the publish completes, **Then** the prompt closes, the post status flips to `published`, and the form's status display + button visibility update without a manual reload.

---

### User Story 3 - Status dropdown only offers user-controllable values (Priority: P3)

A creator opens the post edit form. The status field shows the post's current status (e.g., `Scheduled`). When they open the dropdown they see only the values they're allowed to set: `Draft`, `Scheduled`, and `Archived`. `Published` and `Failed` are not on the menu. If they try to coerce one of those values via the API directly, the request is rejected with a clear error message.

**Why this priority**: This is an integrity / UX cleanup, not a feature that delivers user value on its own — it depends on Stories 1 and 2 being available so the user has legitimate ways to reach `published`. It still ships value: it removes a footgun where a user can fake a publish (or fake a failure) without anything actually happening.

**Independent Test**: Open the post edit form for a `draft` post; confirm the status dropdown contains exactly `Draft`, `Scheduled`, `Archived`. Send a `PATCH` request with `status = "published"` directly to the API; confirm a 4xx rejection with an explanatory error body.

**Acceptance Scenarios**:

1. **Given** the post edit form is open, **When** the user opens the status dropdown, **Then** the only selectable values are user-controllable statuses (`draft`, `scheduled`, `archived`); `published` and `failed` are not in the menu.
2. **Given** a post that is already `published` or `failed`, **When** the edit form opens, **Then** the status field shows the value as a read-only label, not as an editable dropdown.
3. **Given** a client (curl, Postman, or a custom UI) sends `PATCH /api/v1/posts/{id}` with `status = "published"` (or `"failed"`), **When** the request is processed, **Then** the API rejects it with a 4xx error and a body explaining that those statuses are server-controlled.
4. **Given** a creator scrolls through the form, **When** they see the existing post's status, **Then** the displayed copy is consistent regardless of whether the status is user-controlled or server-controlled (no surprising layout shift between editable and read-only states).

---

### Edge Cases

- **Catch-up on restart**: A post is scheduled for 1:00 PM. The server is down from 12:55 PM to 1:05 PM. On startup at 1:05, the post must publish promptly rather than wait for 1:00 the next day or sit in `scheduled` indefinitely.
- **Past `scheduled_at` on create**: A post is created via API with `scheduled_at` already in the past (an edge already permitted by the existing 003 spec for backfill). Auto-publish fires immediately on the next scheduler tick.
- **Reschedule into the past**: User edits a future scheduled post and sets `scheduled_at` to a past time. The trigger fires on the next tick; the post publishes.
- **Reschedule a published post**: Not allowed — published posts are immutable in the existing model. The form does not expose `scheduled_at` for editing on a published post, and the API rejects status-changing or time-changing PATCHes on published posts.
- **Archive a post with an armed publish trigger**: The trigger is cancelled; the post stays `archived`.
- **Unarchive a post whose original `scheduled_at` is now in the past**: It returns to `previous_status` (e.g., `scheduled`), and the catch-up path publishes it on the next tick.
- **Manual publish on a draft with no `scheduled_at`**: Allowed. Status becomes `published`. `scheduled_at` remains null OR is stamped with the publish time (see Assumptions for the chosen default).
- **Two clients try to publish the same post simultaneously**: One wins (status flips to `published`); the other is a no-op (the second PATCH sees the post is already `published` and returns success, idempotently).
- **Server clock skew**: Auto-publish reasons about "is this time past?" using the same EST wall-clock helper the existing past-time guard uses, so behavior is consistent across the codebase.
- **Failure simulation**: If, in a future iteration, the publish step fails (e.g., a real social-platform integration returns an error), the status transitions to `failed`. The `failed` status remains in the schema as a server-only outcome; users can never set it themselves.
- **Concurrent reschedule + scheduled time arriving**: The user PATCHes the post to a new `scheduled_at` at the exact moment the old trigger fires. The system must end up with the post in a consistent state — either published at the old time (if the trigger fired first and committed) or armed for the new time (if the PATCH committed first). Mixed states (e.g., partially-applied) must not occur.
- **Series stage stalled by archived predecessor**: A series with stage 1 archived has stages 2, 3, 4 still scheduled. When their times arrive, each stays `scheduled` (no auto-publish) per FR-009a. The creator can clear the stall by manually publishing stages individually (which also bypasses FR-009a per FR-015a) or by archiving the whole series.
- **Predecessor catches up after successor's time has passed**: Stage 1's `scheduled_at` is `T`, stage 2's is `T+1h`. Stage 1 fails to auto-publish (e.g., archived then unarchived, or simply blocked). At `T+2h`, the creator manually publishes stage 1. Per FR-009b, stage 2 is then immediately auto-published (its `scheduled_at` is in the past and its predecessor just became `published`). Stages 3 and 4 follow the same rule when their respective predecessors transition to `published`.
- **User cancels the publish confirmation**: The creator clicks "Publish post," sees the confirmation modal, then clicks Cancel. The post stays in its prior status (`draft` or `scheduled`); no API call has been made; any armed auto-publish trigger remains armed for its `scheduled_at`.
- **Auto-publish fails on first attempt, succeeds on retry**: Stage 2 is scheduled for `T`. At `T`, the DB write fails transiently. Per FR-007a, stage 2 stays `scheduled` and gets a "last auto-publish attempt failed; will retry" annotation visible to the owner. On the next scheduler tick (or backend restart catch-up), the system retries; the publish succeeds. Per FR-007b, the annotation clears and the status flips to `published`.
- **Failed-attempt annotation persists across reload**: An auto-publish failure occurs at 14:00; the creator opens the dashboard at 17:00. The post is still annotated as "last auto-publish failed at 14:00, will retry" until a successful publish (or until manual intervention) clears it.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Auto-publish (Story 1)

- **FR-001**: The system MUST automatically transition a post from `scheduled` to `published` once its `scheduled_at` time has elapsed.
- **FR-002**: Auto-publish MUST run inside the same backend process that serves the API (no separate worker process or external queue), driven by an in-process asynchronous scheduler.
- **FR-003**: On backend startup, the scheduler MUST re-arm a publish trigger for every post whose status is `scheduled` and whose `scheduled_at` is in the future, AND MUST publish immediately every post whose status is `scheduled` and whose `scheduled_at` is already in the past (catch-up).
- **FR-004**: When a post's `scheduled_at` is changed (a reschedule), the system MUST cancel the previous publish trigger and arm a new one for the new time.
- **FR-005**: When a post is archived, deleted, or transitioned out of `scheduled` for any reason before its scheduled time, the system MUST cancel its publish trigger.
- **FR-006**: Auto-publish MUST evaluate "is this time past?" using the project EST wall-clock convention (consistent with the existing past-time check used at create / PATCH time).
- **FR-007**: An auto-publish event MUST emit a diagnostic log entry sufficient to identify which post was published and when, for post-mortem and audit.
- **FR-007a**: When an auto-publish attempt fails for internal reasons (transient DB error, mid-write crash, constraint violation in the status-flip step), the system MUST: (1) leave the post in `scheduled` (it is NOT marked `failed` — that status remains reserved for external-platform integration); (2) emit a diagnostic log entry; (3) surface the failure to the post's owner via the UI as a non-blocking annotation (e.g., a "⚠ Last auto-publish attempt failed — will retry" badge on the post in list / track / detail views and in the edit form); (4) include enough context in the user-visible annotation that the owner understands "this post did not auto-publish at its scheduled time and the system will try again," with the timestamp of the last attempt.
- **FR-007b**: A failed-attempt annotation MUST be cleared automatically once a subsequent auto-publish (or a manual publish) succeeds for that post. The annotation MUST persist across server restarts so the user does not lose visibility of the failure if they look at it after a reload.
- **FR-008**: The frontend MUST surface the new `published` status to users without a manual page reload, within at most 60 seconds of the auto-publish event.
- **FR-009**: A published post MUST NOT be re-published a second time across restarts (the publish operation MUST be idempotent — re-running the auto-publish step on a `published` post is a no-op).
- **FR-009a**: For posts that are members of a series (`series_id` is set), auto-publish MUST require that the immediate predecessor stage (the post in the same series with `series_position` exactly one less) has `status = "published"`. If the predecessor is in any other state (`scheduled`, `draft`, `archived`, or `failed`), the post MUST NOT auto-publish at its scheduled time — it remains in `scheduled` and the system MUST emit a diagnostic log entry explaining the skip. Stage 0 (the first stage) has no predecessor and is always eligible to auto-publish.
- **FR-009b**: A skipped (predecessor-blocked) auto-publish MUST be re-evaluated on the next relevant trigger — specifically, when the predecessor later transitions to `published` (via auto-publish or manual publish), the system MUST re-evaluate any successor stages whose `scheduled_at` is already in the past and auto-publish them in stage order. Successor stages whose `scheduled_at` is still in the future remain armed for their own scheduled time.

#### Manual publish (Story 2)

- **FR-010**: The post edit UI MUST expose a "Publish post" action for posts whose current status is `draft` or `scheduled`.
- **FR-011**: The "Publish post" action MUST NOT be exposed for posts whose status is `published`, `failed`, or `archived` (those have no valid manual-publish target).
- **FR-012**: When the user invokes the "Publish post" action, the system MUST immediately transition the post to `published` and cancel any armed auto-publish trigger for that post (so the user-driven publish does not double-fire when the scheduled time later arrives).
- **FR-013**: The visible UI state (status badge, "Publish post" button availability, dashboard counts that key off published-this-week) MUST update within 2 seconds of a successful manual publish, without requiring a page reload.
- **FR-014**: A manual publish on a post that is already `published` MUST be treated as a successful no-op (idempotent), not as an error.
- **FR-015**: The manual publish operation MUST go through a dedicated server endpoint or path designed for that transition; it MUST NOT depend on the client sending `status = "published"` via the generic edit endpoint.
- **FR-015a**: The manual publish operation MUST bypass the sequential predecessor rule (FR-009a). When a creator explicitly clicks "Publish post" on a series stage, the post is published immediately even if its predecessor stage is not yet `published`. Rationale: manual publish reflects deliberate human intent that overrides automatic ordering; the spec treats human authority as superior to the sequential automation.
- **FR-015b**: The "Publish post" action MUST require explicit confirmation before committing. The system MUST present a confirmation prompt with a short message that publishing cannot be undone, with Cancel and Publish actions. The status MUST NOT change until the user confirms. Cancellation MUST leave the post in its prior state with no side effects.

#### Status transition lockdown (Story 3)

- **FR-016**: The post status dropdown in the post create / edit form MUST NOT include `published` or `failed` as selectable options.
- **FR-017**: For posts whose current status is `published` or `failed`, the form MUST display the status as a read-only label, not as an editable dropdown control.
- **FR-018**: The API endpoints that accept a `status` value (post-create, post-edit) MUST reject any client request that sets `status` to `published` or `failed`, returning a 4xx response with a body whose error code makes clear that the value is server-controlled.
- **FR-019**: The `failed` status MUST only ever be set by the backend in response to a publish failure (today: not triggered, since the publish step is internal; reserved for future external-platform integration). Users MUST NOT have any path to set `failed` manually.
- **FR-020**: The `published` status MUST only ever be set by the backend, via either the auto-publish path (FR-001) or the dedicated manual-publish endpoint (FR-015). There MUST NOT be any third path.

### Key Entities

- **Post (existing)**: Gains a stronger guarantee on its `status` lifecycle. The values `draft`, `scheduled`, `archived` remain user-settable; `published` and `failed` are now strictly server-set. The transition `scheduled → published` is now an automatic, time-driven event; `* → published` is also reachable via an explicit user-driven action; `* → failed` is reserved for backend publish failures.
- **Publish Trigger (new conceptual entity)**: An in-process scheduled job tied to a single post by id and to its `scheduled_at` time. Its lifecycle: armed when a post enters `scheduled`, re-armed on reschedule, cancelled on archive / delete / unschedule / manual-publish, and fired once at `scheduled_at` to transition the post's status. Triggers do not survive crashes by themselves; survival across restarts is provided by the catch-up rule in FR-003 (the scheduler reads scheduled posts from the database on startup and rebuilds its trigger set).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A post scheduled for time `T` is observable as `published` to any client (UI or API) within 60 seconds after `T`, without any human or client-driven action between `T-60s` and `T+60s`.
- **SC-002**: After clicking "Publish post" on a draft or scheduled post, the user sees the status updated in the UI within 2 seconds in 95% of attempts.
- **SC-003**: 100% of client requests that try to set `status = "published"` or `status = "failed"` via the post-create or post-edit endpoints are rejected with a 4xx response.
- **SC-004**: After a backend restart, every post whose `scheduled_at` was in the past during the downtime is published within 30 seconds of the backend becoming healthy. Zero posts are stuck in `scheduled` past their `scheduled_at` solely because of the restart.
- **SC-005**: No post is published more than once across the lifecycle of the system (no duplicate publishes after restart, no double-publish from a "manual publish then scheduled time arrives" interleaving).
- **SC-006**: Across a representative test session that includes 20 scheduled posts, 5 manual publishes, 10 reschedules, and 1 backend restart, the published-count seen in the dashboard's "Published 7D" widget exactly matches the published-count seen via direct database query — no discrepancy from missed UI refresh or missed scheduler arming.
- **SC-007**: For a series whose 4 stages all become eligible (predecessors `published`, scheduled times all in the past), the series visibly transitions to all-stages-published within 60 seconds of the last predecessor unblock event, with stages publishing in `series_position` order.
- **SC-008**: When an auto-publish attempt fails internally, the post's owner sees a non-blocking failure annotation in the UI within the standard polling window (≤60 seconds). The annotation is persistent — it survives a page reload and a backend restart — and clears automatically when a subsequent attempt succeeds. 100% of internal-publish failures result in user-visible feedback (no silent failures).

---

## Assumptions

- **In-process scheduler is acceptable.** A single backend process drives both the API and the scheduler. No worker process, no external queue (Redis / SQS / etc.). The user explicitly named APScheduler / AsyncIOScheduler as a viable choice; the spec accepts an in-process scheduler in general. **Note**: the implementation plan opts for a stdlib `asyncio` polling loop instead of APScheduler — see `research.md` Decision 1 for the rationale (Principle II — minimize new runtime dependencies). The spec remains library-agnostic; FR-002 only requires "in-process asynchronous scheduler."
- **Single-instance deployment.** The product currently runs as one backend instance; no leader election or cross-instance coordination is required. If multi-instance becomes a concern later, the assumptions section gets revisited.
- **EST wall-clock convention is preserved.** The new scheduler uses the same naive-EST interpretation already used by the existing past-time guard. No new timezone semantics are introduced.
- **"Publish" is a status flip, not an external POST.** This MVP does not integrate with real social-media platforms. Auto-publish and manual-publish both transition status to `published`; they do not populate a `published_url` (default: leave that field null in this MVP — it gets populated when real-platform integration ships).
- **`scheduled_at` is preserved across publish.** When a post moves from `scheduled` to `published` (whether by auto-publish or manual publish), its `scheduled_at` value is left unchanged — it represents the *planned* publish time and serves as the de-facto record of when the post was published. (If a future iteration wants a separately tracked actual-publish timestamp, that's a schema add, deferred.)
- **Polling is the v1 freshness mechanism.** The frontend already refetches list data on user actions; for the auto-publish-arrival case, a heartbeat refetch on a regular cadence (≤60 seconds) is acceptable. SSE / WebSocket are out of scope for v1.
- **`Archived` remains in the user-facing dropdown.** The user prompt singled out `published` and `failed` for removal but did not name `archived`. The dropdown therefore continues to offer `draft`, `scheduled`, `archived`. (If a stronger separation is desired — archive only via the dedicated archive button — that's a follow-up.)
- **`Failed` lives on as a schema value but is not reachable in this MVP.** Today the publish step does not call any external service that could fail. The `failed` status is preserved for the future external-platform integration; users still cannot set it.
- **Existing 15-minute same-platform gap rule is unchanged.** The auto-publish path does not relax or strengthen the gap rule. Posts that violate the gap can never both be scheduled, so the scheduler never sees a conflicting pair.
- **Existing archive semantics are unchanged.** Archived posts remain invisible to the gap rule and never publish; archive is the soft-delete primitive for already-published posts.

---

## Out of Scope

- Actual social-media platform integration (Instagram / TikTok / YouTube / X / LinkedIn HTTPS push). The publish step is internal-only in this MVP.
- Multi-instance scheduler with leader election or distributed locking.
- Real-time push channels (Server-Sent Events, WebSockets) for status updates. Polling is the chosen mechanism.
- Retry / backoff / dead-letter queue for publish failures. With no external publish call to fail, retry has nothing to retry against.
- Status state-machine guards beyond the publish-related transitions defined here (e.g., a `draft → scheduled` guard, or preventing archive of a `failed` post). The user prompt did not call for a full state machine; only the publish-related lockdown.
- A separate `published_at` column distinct from `scheduled_at`. Defaulted to "preserve `scheduled_at` as the de-facto publish time" per Assumptions.
- Migrating any existing branch's prior auto-publish work. The repo has an abandoned `005-auto-publish-scheduled` branch; this spec stands on its own and may or may not borrow from that branch at implementation time.
- A11y polish on the new "Publish post" button and the read-only status field beyond standard form-control labeling. (Aligned with the existing modal-a11y limitations called out in `frontend-integration-plan/REVIEW.md`.)

---

## Traceability

- User input: `scheduler-details/prompt.md`
- Existing scheduling invariant: `backend/app/core/scheduling.py` (`check_platform_gap`, `is_past_est`)
- Existing post lifecycle definition: `backend/app/models/post.py` (`PostStatus`)
- Existing edit form behavior: `frontend/src/components/PostForm.jsx`
- Existing list / dashboard refresh pattern: `frontend/src/hooks/useScheduleData.js`
- Constitution principles relevant here: III (Enforce Scheduling Invariants — NON-NEGOTIABLE), IX (Test-First for Backend API — NON-NEGOTIABLE), VII (User-Friendly UI Development).
