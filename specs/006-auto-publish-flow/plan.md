# Implementation Plan: Auto-Publish Flow & Status Transition Lockdown

**Branch**: `006-auto-publish-flow` | **Date**: 2026-04-24 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/006-auto-publish-flow/spec.md`

## Summary

Add an in-process asynchronous mechanism that automatically transitions `scheduled` posts to `published` once their `scheduled_at` has elapsed, surface a manual "Publish post" path (with confirmation), enforce the new status-transition rules at the API boundary so clients can no longer self-promote a post to `published` or `failed`, and surface internal-publish failures to the post owner via a non-blocking annotation.

Approach in one paragraph: a small, **stdlib-only** asyncio polling loop is started in FastAPI's lifespan handler. Every 15 seconds it sweeps `posts WHERE status='scheduled' AND scheduled_at <= now_est` and runs each candidate through a publish step that respects the **series sequential rule** (Q1 / FR-009a) and writes a per-post failure annotation on transient errors (Q3 / FR-007a). A new endpoint `POST /api/v1/posts/{id}/publish` provides the manual path, gated by a `ConfirmModal` in the UI (Q2 / FR-015b). A new `PostStatusUserSettable` Literal in the Pydantic schemas restricts client-driven status writes on `POST /api/v1/posts` and `PATCH /api/v1/posts/{id}` (FR-018). The frontend's existing 60-second polling cadence (Q4) suffices for visibility — no SSE / WebSocket required.

## Technical Context

- **Language / Version**: Python 3.11 (backend), Node 20 + React 19 (frontend) — existing.
- **Primary Dependencies**: FastAPI, SQLAlchemy 2 (async), aiosqlite, python-jose, bcrypt, date-fns. **Zero new runtime dependencies.** APScheduler was named in the user prompt and considered, but `research.md` documents why the stdlib `asyncio` polling loop is preferred (Principle II; matches the prior-art on the abandoned `005-auto-publish-scheduled` branch).
- **Storage**: SQLite via `aiosqlite` (existing). Two new nullable columns added to `posts` for the failure annotation.
- **Testing**: pytest 8.3 + pytest-asyncio 0.24 (backend), Vitest 2.1 + React Testing Library (frontend) — existing.
- **Target Platform**: Linux container behind FastAPI + Vite static build; modern desktop / tablet browsers.
- **Project Type**: web application — backend (`backend/`) + frontend (`frontend/`).
- **Performance Goals**: ≤60 s UI freshness on auto-publish (SC-001), ≤30 s catch-up after restart (SC-004), ≤2 s manual-publish UI update (SC-002).
- **Constraints**: single-instance deployment; no external workers, queues, or Redis (Principle II); EST naive-ISO wire convention preserved (Assumption); manual publish bypasses sequential predecessor rule (FR-015a).
- **Scale / Scope**: tens to low hundreds of scheduled posts per owner; each polling tick scans only `status='scheduled'` rows so cost stays linear in active scheduled volume, not total posts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|---|---|---|
| I | Extend, Don't Rewrite | ✓ | New module `backend/app/core/publisher.py`, two new columns added additively to `posts`, one new endpoint `POST /api/v1/posts/{id}/publish` registered alongside existing handlers. No file rewrites. |
| II | Stay on Existing Stack | ✓ | Zero new runtime deps. Stdlib `asyncio.create_task` + `asyncio.sleep` are sufficient. APScheduler considered and rejected — see `research.md` Decision-1. |
| III | Enforce Scheduling Invariants (NON-NEGOTIABLE) | ✓ | The 15-min gap rule is unaffected: auto-publish only flips status, no new write paths that bypass `check_platform_gap`. New tests confirm a previously-conflicting pair cannot both be scheduled, so the publisher never sees them. |
| IV | Pragmatic Test Coverage (scoped) | ✓ | Backend non-API modules (`publisher.py`, schema tweaks) get pytest coverage proportional to risk. Frontend uses Vitest for the new ConfirmModal flow + status-dropdown filter. |
| V | Clear Structure & Documented Tradeoffs | ✓ | This plan + `research.md` enumerate every decision with rationale. The PR description will follow Principle V's five-element template (approach / assumptions / tradeoffs / improvements / Loom). |
| VI | Surface and Resolve Spec Conflicts (NON-NEGOTIABLE at gates) | ✓ | `/speckit.clarify` ran before this plan and recorded 4 clarifications. No remaining ambiguity blocks `/speckit.tasks`. |
| VII | User-Friendly UI Development | ✓ | "Publish post" is a destructive-equivalent action requiring confirmation (FR-015b). Failure annotation fulfills the "every failure path renders an actionable message" rule. Status field remains a labeled control even when read-only (FR-017). |
| VIII | Code Quality — Idiomatic, Minimal, Reviewable | ✓ | Reuses existing `AsyncSession`, `select(...).where(...)` patterns; new `PublisherService` is single-file, no class hierarchy. No emoji. Domain names (`scheduled_at`, `last_publish_attempt_at`) preserved. |
| IX | Test-First for Backend API (NON-NEGOTIABLE) | ✓ | Tests for `POST /api/v1/posts/{id}/publish` and the status-transition rejection paths on `POST/PATCH /api/v1/posts` will be written first, fail, then pass. Tests for `publisher.py` (predecessor-blocked / catch-up / retry-clears-annotation / failure-annotation-surface) likewise. |
| X | API Compatibility & UX Consistency | ✓ | New endpoint follows `POST /api/v1/posts/{id}/<verb>` convention (matches existing `archive` / `unarchive`). Error shape reuses the existing `{error, message, ...}` family. Two new fields on `PostResponse` are additive. |

**Result**: All gates pass. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/006-auto-publish-flow/
├── plan.md              # This file
├── spec.md              # /speckit-specify output (clarifications integrated)
├── research.md          # Phase 0 — scheduler library decision + retry strategy + freshness tradeoff
├── data-model.md        # Phase 1 — new Post columns + state-transition table
├── contracts/
│   ├── publish-endpoint.md        # POST /api/v1/posts/{id}/publish
│   └── status-validation.md       # POST/PATCH /api/v1/posts status restrictions
├── quickstart.md        # Phase 1 — end-to-end manual verification steps
└── checklists/
    └── requirements.md  # Spec quality checklist (carried forward)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── api/
│   │   └── posts.py                      # MODIFIED: add POST /publish; restrict status on POST/PATCH
│   ├── core/
│   │   ├── publisher.py                  # NEW: asyncio polling loop + failure-annotation logic
│   │   └── scheduling.py                 # UNCHANGED (gap rule already correct)
│   ├── models/
│   │   └── post.py                       # MODIFIED: add last_publish_attempt_at, last_publish_error
│   ├── schemas/
│   │   └── post.py                       # MODIFIED: PostStatusUserSettable Literal; PostResponse +2 fields
│   └── main.py                           # MODIFIED: lifespan starts/stops the publisher loop
└── tests/
    ├── test_publisher.py                 # NEW: tick / catch-up / sequential / retry-clears / failure-surface
    ├── test_posts_publish_endpoint.py    # NEW: POST /publish happy + failure paths (Principle IX)
    └── test_posts.py                     # AUGMENTED: status-rejection tests on create/edit

frontend/
├── src/
│   ├── components/
│   │   ├── PostForm.jsx                  # MODIFIED: status dropdown filter; Publish button + confirm modal
│   │   ├── PostCard.jsx                  # MODIFIED: failure-annotation icon + tooltip
│   │   ├── SeriesCard.jsx                # MODIFIED: failure-annotation on per-stage tile
│   │   └── ConfirmModal.jsx              # REUSED — already exists
│   ├── api/
│   │   └── client.js                     # MODIFIED: add postsApi.publish(id)
│   ├── hooks/
│   │   └── useScheduleData.js            # MODIFIED: add 30-second heartbeat refetch
│   └── components/utils.js               # UNCHANGED (no time-helper changes needed)
└── src/components/PostForm.test.jsx      # NEW: status-dropdown filter; Publish flow with confirm
```

**Structure decision**: Existing two-tree layout (`backend/`, `frontend/`) preserved. The new feature touches **5 backend files** (1 new module, 1 new test file, 1 new test for the new endpoint, 3 small modifications) and **5 frontend files** (1 new test, 4 small modifications). Reviewability target: ≤30 minutes per Principle V.

## Complexity Tracking

| Item | Why It's Justified | Simpler Alternative Rejected Because |
|---|---|---|
| New columns `last_publish_attempt_at` + `last_publish_error` on `posts` | Q3 (FR-007a) requires user-visible failure surface that survives reload and restart. | A sidecar audit table is more idiomatic but doubles the read cost on every list query and adds a JOIN to every `PostResponse` build. Two nullable columns is cheaper for the same observable behavior. |
| New endpoint `POST /api/v1/posts/{id}/publish` | FR-015 mandates a dedicated server endpoint; reusing PATCH would force the frontend to send `status="published"` which contradicts FR-018. | Reusing PATCH was rejected because it requires the very thing FR-018 forbids (client-driven `status="published"`). |
| 30-second heartbeat refetch in `useScheduleData` | Required to satisfy SC-001 (≤60 s UI freshness) without changing the existing on-action refetch model. | Per-post WebSocket / SSE was explicitly placed Out of Scope by Q4. |
| Manual publish bypasses sequential rule (FR-015a) | Recorded human intent must be able to override automation; otherwise creators are stuck behind blocked stages forever. | Forcing manual publish to also obey the predecessor rule trades user agency for a sequencing invariant the user explicitly didn't ask for. |

No constitution violations. The plan does not introduce a 4th project, a new repository pattern, or a new long-lived service.

## Backwards-Compatibility Note

This feature includes one **type-narrowing change** on existing endpoints that Principle X classifies as a request-shape change rather than a purely additive one. Calling it out explicitly so the PR reviewer doesn't have to discover it from a 422:

- **`POST /api/v1/posts`** and **`PATCH /api/v1/posts/{id}`** — the `status` field's accepted set narrows from the full `PostStatus` enum (5 values: `draft`, `scheduled`, `published`, `failed`, `archived`) to `Literal["draft", "scheduled", "archived"]` (3 values). Clients that previously sent `status="published"` or `status="failed"` via these endpoints will now receive a 422 with a Pydantic literal-error detail.

**Migration path for affected clients**:

- Replace any `PATCH /api/v1/posts/{id}` body containing `status="published"` with a call to the new `POST /api/v1/posts/{id}/publish` endpoint (FR-015).
- There is no migration for `status="failed"` — that value was always a server-only outcome (FR-019); the new validation simply makes that intent enforceable.

The `PostResponse` shape is unchanged (still serializes the full enum). Read-side clients are unaffected.

This deviation is acceptable under Principle X because the change is documented here and in `contracts/status-validation.md`, a clear replacement endpoint exists for the only legitimate prior use case, and the previous looseness was a footgun the spec closes intentionally. T045 surfaces this in the PR description per Principle V's "tradeoffs" element.

## Phase 0 — Research

See `research.md`. Three decisions resolved:

1. **Scheduler library**: stdlib `asyncio` polling loop, **not** APScheduler.
2. **Retry / failure-handling strategy**: per-post bounded retry (3 attempts, 1s / 2s / 4s backoff) inside the tick, then leave the post in `scheduled` and surface the failure via the new annotation columns. No promotion to `failed` (FR-019 reserves that for external integration).
3. **Frontend freshness mechanism**: existing 30-second heartbeat refetch on `useScheduleData`. No SSE / WebSocket.

## Phase 1 — Design & Contracts

See `data-model.md` for the column additions + state-transition table, `contracts/publish-endpoint.md` and `contracts/status-validation.md` for the endpoint contracts, and `quickstart.md` for the end-to-end manual verification steps a reviewer can run in ≤10 minutes.

## Out of Scope (carried from spec)

- Real social-media platform integration (Instagram / TikTok / YouTube / X / LinkedIn HTTPS push). The publish step remains an internal status flip.
- Multi-instance scheduler with leader election or distributed locking.
- Real-time push channels (SSE / WebSocket).
- Retry / dead-letter queue for external publish failures (no external publish exists yet).
- Status-machine guards beyond the publish-related transitions (e.g., a `draft → scheduled` guard).
- A separate `published_at` column distinct from `scheduled_at` (Assumption preserves `scheduled_at` as the de-facto publish time).
- A11y polish on the new "Publish post" button beyond standard form labeling.
