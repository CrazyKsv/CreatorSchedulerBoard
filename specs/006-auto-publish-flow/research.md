# Phase 0 Research

**Feature**: 006-auto-publish-flow
**Date**: 2026-04-24

Three decisions had multiple reasonable interpretations and benefit from explicit reasoning before implementation. Each decision below states what was chosen, why, and which alternatives were ruled out.

---

## Decision 1 — Scheduler library

**Chosen**: A stdlib-only `asyncio` polling loop, started and stopped from FastAPI's `lifespan` handler. The loop wakes every 15 seconds, queries `posts WHERE status='scheduled' AND scheduled_at <= now_est`, processes each result, and sleeps again.

**Rationale**:

1. **Principle II (Stay on Existing Stack)** disallows new runtime dependencies unless justified. APScheduler is one such dependency. Before paying the dep cost, we must show APScheduler delivers something the stdlib loop doesn't — and it doesn't, at the freshness budget the spec actually wants.
2. **The freshness budget is generous.** SC-001 says ≤60 seconds UI freshness; SC-004 says ≤30 seconds catch-up on restart. A 15-second tick comfortably satisfies both: worst-case detection latency = TICK + processing time ≤ ~16 s; restart catch-up = first tick fires immediately.
3. **The codebase already proves out this pattern.** The abandoned `005-auto-publish-scheduled` branch shipped a working `backend/app/core/publisher.py` (~320 lines including tests) using the same stdlib approach. We can borrow its skeleton — the file structure, the tick loop, the retry math — without inheriting its SSE machinery (which we're explicitly skipping per Q4).
4. **Test ergonomics.** A polling loop is trivially testable: spawn the tick function with a mocked clock or a single-iteration variant. APScheduler's job-store + executor abstractions add layers that have to be mocked or stubbed, increasing test surface.
5. **No precision argument.** APScheduler's per-job triggers are precise to the second, but our user-visible budget is a minute. Trading a runtime dep for sub-second precision we don't surface to users is a bad trade.

**Alternatives considered**:

- **APScheduler 3.x (AsyncIOScheduler)**: matches the user's named preference. Adds a runtime dep. Pros: precise triggers, mature, lifecycle hooks. Cons: extra dep + extra mental model + extra mocking surface in tests + Principle II review-cost. Net: no measurable user benefit at the spec's freshness budget. Rejected.
- **APScheduler 4.x**: still beta, breaking changes vs 3.x, weaker async story. Rejected outright.
- **arq / Celery / RQ**: require an external broker (Redis / RabbitMQ). Direct Principle II violation. Rejected.
- **rocketry**: less mature, smaller community, no advantage over stdlib. Rejected.
- **Per-post `asyncio.create_task` armed at create / patch time**: precise, but state-management nightmare across restarts (no on-disk job store) and across reschedule (cancel + re-create). The polling loop sidesteps both by re-discovering candidates from the DB every tick. Rejected.

**Note about the user's prompt**: The user wrote "Use APScheduler … should be a good option for simplicity." That recommendation was made before they had visibility into the stdlib pattern's prior-art on the 005 branch. The plan still satisfies the underlying intent (in-process scheduler, no external services) — it just picks the simpler implementation path under the same constraint. The PR description should call this out so the reviewer doesn't expect APScheduler in the diff.

---

## Decision 2 — Retry strategy on internal publish failure

**Chosen**: Per-post bounded retry **inside a single tick**: 3 attempts with `1s / 2s / 4s` backoff. If all 3 attempts fail, the publisher leaves the post in `scheduled`, persists `last_publish_attempt_at` + `last_publish_error` on the row, logs a structured warning, and moves on to the next candidate. The next tick (15 s later) will pick the same row up again — at which point the cycle repeats. The annotation persists across ticks and across server restarts until a publish eventually succeeds, which clears the columns to `NULL`.

**Rationale**:

1. **Q3 explicitly chose `Option C with user-visibility`**: leave in `scheduled`, do not flip to `failed`, surface the failure to the user via a non-blocking annotation (FR-007a / FR-007b). The retry loop is the mechanism that delivers "we'll try again" honestly.
2. **Three attempts absorb the dominant failure mode (transient SQLite contention).** Most internal failures during a status flip will be transient. 3 attempts × geometric backoff ≈ 7 seconds total — fits inside the 15-second tick cadence with margin.
3. **Annotation, not status mutation.** Per FR-019, the `failed` status remains reserved for external-integration failures. Today the publish step is a DB write; if it can't commit, the right answer is "the system is having trouble," not "this post failed forever." The annotation tells the user that without changing the post's intent.
4. **No exponential expansion across ticks.** Because retries are bounded inside the tick, we don't grow a back-off horizon that could leave a post un-attempted for hours. Every 15 seconds is a fresh chance.

**Alternatives considered**:

- **Promote to `failed` on first error**: simple but contradicts the user's Q3 answer and FR-019. Rejected.
- **Unbounded retry until success**: a poison row could starve the rest of the queue inside one tick. Rejected.
- **Retry across ticks only (no in-tick retry)**: any in-tick transient blip would surface to the user as a failure annotation immediately. Worse UX. Rejected.
- **Exponential back-off across ticks (1s, 2s, 4s, 8s, 16s …)**: introduces a bookkeeping column ("next retry at"). Out of scope cost vs benefit. Rejected.

**Open knob (test-time only)**: the retry counts and the tick interval will be tunable constants at the top of `publisher.py` so the test suite can compress them.

---

## Decision 3 — Frontend freshness mechanism

**Chosen**: Extend `frontend/src/hooks/useScheduleData.js` with a 30-second `setInterval` heartbeat that calls `fetchAll()`. Pause the heartbeat when the document is hidden (`document.visibilityState !== 'visible'`) and resume on `visibilitychange`. Existing on-action refetches stay.

**Rationale**:

1. **Q4 picked `Option A` — keep 60 s UI freshness, 30 s catch-up.** A 30-second heartbeat is the simplest mechanism that satisfies both: the worst-case combined latency (publisher tick 15 s + UI heartbeat 30 s) is 45 s, well under the 60 s budget.
2. **Pausing on hidden tab is free goodwill.** The browser throttles `setInterval` aggressively on hidden tabs, so the optimization mostly aligns the code with what the runtime is going to do anyway, but it also means we don't burn the API quota when the user has 12 tabs open.
3. **No new dep.** No SSE, no WebSocket, no library. Just a `useEffect` on top of existing data hooks. Matches Principle II.

**Alternatives considered**:

- **Server-Sent Events (SSE)**: would push status changes from the publisher to subscribed clients. Lower latency. But requires an event-stream endpoint, a client-side `EventSource`, and explicit Out-of-Scope language in the spec. Q4's choice rules this out. (The 005 branch built this; we're not borrowing it.) Rejected.
- **WebSocket**: same outcome, more state, more code. Rejected.
- **Per-post polling on the open form**: fine-grained but doesn't help the dashboard / list / track surfaces, which are where the user spends most time. Rejected as insufficient alone.
- **Refetch-on-focus only (no heartbeat)**: misses the case where the user has the dashboard open while their post auto-publishes. Doesn't satisfy SC-001. Rejected.

---

## Inputs reviewed

- `ASSIGNMENT.md` — original brief, scheduling-constraint section.
- `specs/006-auto-publish-flow/spec.md` — clarified spec including the 4 Q-A entries from `/speckit.clarify`.
- `.specify/memory/constitution.md` v1.2.0 — Principles II (no new deps) and IX (Test-First for backend API) drive the scheduler-library and retry-strategy decisions.
- `005-auto-publish-scheduled` branch — `backend/app/core/publisher.py` (320-line implementation already aligned with stdlib polling). Provides the skeleton this plan adopts.
- `frontend/src/hooks/useScheduleData.js` — current refetch model (action-driven); sets the baseline this plan extends.
- `backend/app/core/scheduling.py` — `is_past_est`, `nowEstParts` already exist for the EST wall-clock comparisons the publisher needs.

---

## Items deliberately deferred

These would be nice but are not load-bearing for the spec:

- A `published_at` column distinct from `scheduled_at`. Today `scheduled_at` doubles as the de-facto publish time per Assumption; if a future feature needs separate planned-vs-actual, that's a schema add.
- An admin-facing observability dashboard for failed-publish attempts. The user-visible annotation is enough for MVP.
- A configurable polling interval (env var). 15 seconds is a good constant; making it configurable is a 30-second change later if needed.
- Cross-instance leader election. Single-instance is the deployment shape (Assumption); when that changes, this paragraph gets revisited.
