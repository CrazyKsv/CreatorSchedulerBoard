<!--
Sync Impact Report
==================
Version change: 1.1.0 → 1.2.0
Rationale: MINOR bump. Four new principles added (VII–X). Principle IV's
scope is narrowed — not redefined or removed — so MAJOR is not required.

Principles:
  I.    Extend, Don't Rewrite                                        (unchanged)
  II.   Stay on the Existing Stack                                   (unchanged)
  III.  Enforce Scheduling Invariants (NON-NEGOTIABLE)               (unchanged)
  IV.   Pragmatic Test Coverage                                      (scoped narrower — now excludes backend API code governed by Principle IX)
  V.    Clear Structure & Documented Tradeoffs                       (unchanged)
  VI.   Surface and Resolve Spec Conflicts Before Execution
        (NON-NEGOTIABLE at execution gates)                          (unchanged)
  VII.  User-Friendly UI Development                                 [ADDED]
  VIII. Code Quality — Idiomatic, Minimal, Reviewable                [ADDED]
  IX.   Test-First for Backend API (NON-NEGOTIABLE)                  [ADDED]
  X.    API Compatibility & UX Consistency                           [ADDED]

Sections:
  - Technical Constraints     (unchanged)
  - Delivery Workflow         (updated: Test-First discipline added to the
                               per-feature pre-flight list; UI quality check
                               added for features that ship UI)
  - Governance                (updated: Principle IX added to the blocking
                               list alongside III and VI)

Grandfather clause:
  - Feature 001-docker-compose (merged PR) pre-dates Principle IX and is
    explicitly exempt. Its existing test coverage is not re-evaluated.
  - Feature 002-content-series — plan was finalized earlier on 2026-04-22
    before this amendment. The feature owner MAY either (a) revise 002's
    plan.md / tasks.md to adopt Test-First for the new backend API
    endpoints (`POST/GET/PATCH/DELETE /api/series`, plus `check_platform_gap`
    in `backend/app/core/scheduling.py`, plus the new invariant hooks in
    `backend/app/api/posts.py`) by writing tests first and letting them
    fail before implementation, or (b) invoke the grandfather clause in
    the PR description. Option (a) is the spirit of the amendment and is
    preferred.

Templates reviewed:
  ✅ .specify/templates/plan-template.md — generic "Constitution Check"
     routes through current principles; no edit required.
  ✅ .specify/templates/spec-template.md — no structural change needed.
  ✅ .specify/templates/tasks-template.md — task categorization is
     principle-agnostic; no edit required. (Task generators for features
     under Principle IX will naturally interleave test tasks before
     implementation tasks for each new API endpoint.)
  ✅ readme.md, docs/*, plan/README.md — no wording changes required; all
     existing tests and lint rules pass under the amended constitution.

Follow-up TODOs: none.
-->

# Creator Scheduler Take-Home Constitution

## Core Principles

### I. Extend, Don't Rewrite

The existing Creator Scheduler (FastAPI backend, React frontend, SQLite, JWT auth)
is the baseline. New work — specifically the Content Series feature — MUST be added
as incremental extensions that fit naturally into the current module layout
(`backend/app/{api,core,models,schemas}`, `frontend/src/{api,components,context,pages}`).
Renaming, relocating, or rewriting existing modules is disallowed unless required to
satisfy a scheduling invariant or to eliminate a genuine blocker.

**Rationale**: The assignment explicitly forbids rewriting the project from scratch
and the 3-hour timebox makes large refactors a direct threat to working behavior.

### II. Stay on the Existing Stack

Backend changes MUST use FastAPI, SQLAlchemy 2 (async), and SQLite. Frontend changes
MUST use React 19, Vite, React Router 7, and the existing API client pattern in
`frontend/src/api`. New runtime dependencies SHOULD be avoided; when unavoidable,
the PR description MUST justify the addition. No new services, databases, queues, or
background workers.

**Rationale**: Reviewers evaluate the solution against the stack defined in
`readme.md`. Introducing new infrastructure inflates scope and review cost without
advancing the assignment.

### III. Enforce Scheduling Invariants (NON-NEGOTIABLE)

Posts on the same platform MUST NOT be scheduled within 15 minutes of each other.
This invariant applies to:

- Creating or updating a single post.
- Generating or materializing posts from a Content Series (bulk and per-post paths
  alike).
- Any future scheduling mutation endpoint.

Enforcement MUST occur on the backend and MUST reject the offending write with a
clear error (4xx with a message identifying the conflicting post/platform/time).
Frontend-only validation is insufficient. Tests MUST cover at least the within-window
rejection case and the exact-boundary acceptance case.

**Rationale**: This is the one hard constraint called out in the assignment. Silent
violations or client-only enforcement would be an immediate correctness failure.

### IV. Pragmatic Test Coverage (scope narrowed by Principle IX)

Full TDD is not required for code outside the scope of Principle IX. Every
non-API-backend and frontend change MUST ship with tests proportional to its risk:

- Scheduling-invariant logic (Principle III) MUST have backend tests (pytest).
- New frontend components with non-trivial logic SHOULD have a Vitest/RTL test when
  they touch API calls, form submission, or series scheduling math.
- Backend non-API modules (models, schemas, migrations, seed scripts) SHOULD have
  tests where the logic has real branches; a trivial Pydantic schema does not need
  a dedicated test file.
- Existing passing tests MUST continue to pass; breaking them without replacement is
  forbidden.

**Relationship to Principle IX**: backend **API endpoints** (code under
`backend/app/api/`) and the core modules they directly depend on for correctness
(e.g., `backend/app/core/scheduling.py`) are governed by Principle IX (Test-First
NON-NEGOTIABLE), not by this principle. Where the two could apply, Principle IX wins.

**Rationale**: The repo already ships pytest and Vitest suites; keeping them green
and extending them for the new behavior is how correctness is demonstrated to the
reviewer within the timebox. Pragmatism stays the default for UI and non-load-bearing
backend code; Test-First discipline concentrates on the API surface because that is
where behavioral regressions hit the most users.

### V. Clear Structure & Documented Tradeoffs

Code MUST be organized so a reviewer can trace the Content Series feature end-to-end
(model → schema → endpoint → client → page/component) without guessing. Names MUST
reflect domain concepts (`Series`, `cadence`, `position`, etc.). The final Pull
Request description MUST include: approach, assumptions, tradeoffs, what you would
improve with more time, and the 5–10 minute Loom link.

**Rationale**: Reviewers explicitly grade on clear structure, reasonable
assumptions, and the PR narrative; the Loom video is called out as important.

### VI. Surface and Resolve Spec Conflicts Before Execution (NON-NEGOTIABLE at execution gates)

Across every spec-kit step between `/speckit-specify` and `/speckit-implement` —
i.e., during `/speckit-clarify`, `/speckit-plan`, `/speckit-analyze`, and
`/speckit-tasks` — the agent MUST actively scan each generated or edited
artifact for:

- Contradictions between spec and plan (e.g., a requirement the plan silently
  reinterprets or drops).
- Contradictions between plan and research / data-model / contracts.
- Contradictions between any spec-kit artifact and the actual repository state
  (existing code, `readme.md`, `docker-compose.yml`, CI workflow, seed script).
- Ambiguous or underspecified requirements where multiple reasonable
  interpretations exist with materially different implementations.
- Scope creep introduced by a prior step that the spec did not authorize.
- Constitution violations not flagged in earlier phases.

When any such conflict or confusion is detected, the agent MUST:

1. **Halt** before invoking `/speckit-tasks` or `/speckit-implement`.
2. **Announce** each conflict to the user with concrete citations — file paths
   and line numbers, or verbatim quotes of the contradicting statements.
3. **Ask specific, narrow questions** the user can answer concretely. Open-ended
   "what do you think?" prompts are insufficient.
4. **Wait for explicit user answers** before resuming. Auto mode does NOT
   authorize the agent to pick its own answer for a known conflict; it only
   authorizes autonomy over *non-conflicting* routine work.
5. **Persist the answers** into the relevant artifact — typically under the
   Clarifications section of `spec.md`, following the same session-log format
   used by `/speckit-clarify` — before any downstream step runs.

Reasonable defaults remain permitted for *omissions* (per `/speckit-specify`'s
informed-guess rule), but NOT for *conflicts*. The distinction: an omission has
no contradictory statement to resolve; a conflict does.

`/speckit-tasks` and `/speckit-implement` MUST refuse to begin new work if any
unresolved conflict is known to exist in the current feature's artifacts. If
such a state is detected at those gates, the agent MUST halt and route the user
back to `/speckit-clarify` or to a direct question, even if the user explicitly
requested to proceed. A user who wants to override a specific detected conflict
may do so by answering the question inline and having the agent record the
answer per step 5 above — not by asking the agent to skip the check.

**Rationale**: Silent assumptions at the planning-to-execution boundary are the
most common cause of re-work and of wasted reviewer time. A 30-second
clarification is cheaper than a 3-hour implementation of the wrong thing. This
principle codifies the behavior `/speckit-clarify` and `/speckit-analyze`
already exhibit partially and makes it a MUST rather than a nicety.

### VII. User-Friendly UI Development

Every UI surface this project ships MUST make the user's current state and options
obvious without a README. Concretely:

- Every asynchronous action (loading data, submitting a form, deleting a resource)
  MUST render a visible loading state — spinner, disabled button, or equivalent —
  so the user never wonders whether the click registered.
- Every failure path MUST render an actionable error message, not a silent no-op.
  Server-returned messages (e.g., the FR-011 platform-gap conflict message) MUST
  be surfaced directly rather than replaced with generic text.
- Every empty list or empty detail view MUST render an empty-state message that
  names the thing the user would create to fill it ("No series yet — create one
  to plan a campaign").
- Destructive actions (delete series, delete post) MUST require explicit
  confirmation (e.g., a confirm modal or a typed confirmation) before firing.
- New features that add new pages MUST also add nav links in `Layout.jsx`;
  orphaned routes accessible only by direct URL are forbidden.
- Copy across the UI MUST use the same noun for the same domain concept
  (e.g., always "series", never also "campaign" for the same thing). Consistency
  with this principle is jointly enforced with Principle X.

**Rationale**: The reviewer grading a take-home opens the browser before the code.
A UI that silently fails, strands users, or renames concepts mid-flow signals
carelessness even when the backend is perfect.

### VIII. Code Quality — Idiomatic, Minimal, Reviewable

New code MUST match the idioms already present in the repository, not the idioms of
some other project. Specifically:

- Backend: use `AsyncSession` via the existing `get_db` dependency; use Pydantic v2
  features (`Literal`, `Field(ge=..., le=...)`, `model_dump(exclude_unset=True)`);
  use `select().where(...)` rather than legacy `query()` syntax; register routers
  from `main.py`.
- Frontend: use function components with hooks; co-locate page components under
  `frontend/src/pages/`; fetch via the shared `api()` helper in `src/api/client.js`
  rather than raw `fetch`; use `date-fns` for date math (already installed).
- **Minimal**: new code MUST be the minimum necessary to satisfy the spec.
  Refactors of unrelated code are forbidden within a feature PR. Dead code,
  unused imports, and commented-out code MUST NOT be committed.
- **Naming**: names MUST describe domain concepts without abbreviation
  (`scheduled_at`, not `dt`; `series_position`, not `pos`; `check_platform_gap`,
  not `cpg`).
- **Reviewable**: every PR MUST be reviewable in under 30 minutes by a developer
  familiar with the repo. PRs that exceed that size MUST either be split or
  justify their size in the PR description.
- **No emoji in code** unless the user explicitly requests it; no emoji in
  comments or identifiers.

**Rationale**: The codebase is small and opinionated; fighting its idioms adds
reviewer load without user-visible value. Principle VIII keeps diffs predictable
and skimmable, which directly supports Principle V (reviewability).

### IX. Test-First for Backend API (NON-NEGOTIABLE)

Every **new or changed backend API endpoint** MUST be developed Test-First:

- Scope: any handler under `backend/app/api/` (e.g., `posts.py`, `series.py`,
  `auth.py`, or any new router module) AND the core modules the API directly
  depends on for correctness (notably `backend/app/core/scheduling.py` and any
  new domain-service module). Pure infrastructure modules
  (`backend/app/core/database.py`, `backend/app/core/config.py`) are excluded.
- Workflow: tests MUST be written first, MUST fail on their first run against the
  unchanged codebase, and MUST pass after the implementation lands. Both the
  failing and passing states SHOULD be visible in the git history — either
  through a pre-implementation commit with failing tests or through a
  commit-message note in the implementing commit that explicitly states the
  test-before-code ordering.
- Coverage floor: every in-scope endpoint MUST have AT LEAST one happy-path
  test and one failure-path test (auth failure, validation error, or business-
  rule rejection) in the same PR. Happy paths alone are insufficient.
- The 15-minute scheduling invariant (Principle III) MUST have its tests written
  before the `check_platform_gap` implementation.
- Running `pytest` after the tests land but before the implementation MUST show
  them failing. Running `pytest` after the implementation lands MUST show them
  passing.

**Grandfather clause**: features whose plan and tasks were finalized before this
amendment (v1.2.0, 2026-04-22) are exempt — specifically `001-docker-compose`
(merged) and `002-content-series` (plan finalized earlier on 2026-04-22). The
feature owner is encouraged but not required to retroactively apply Principle IX
to 002; if they decline, the PR description MUST note the grandfather invocation
per Principle V.

**Rationale**: Backend API endpoints are behavioral surfaces: any regression is
immediately visible to clients (UI, tests, external integrations). Test-First
catches the one-character mistakes that would otherwise ship. Scoping the rule
to the API surface (instead of "all code") respects the 3-hour timebox and keeps
Principle IV's pragmatism for the parts of the codebase where over-testing has
lower ROI (frontend UI, seed scripts, trivial schemas).

### X. API Compatibility & UX Consistency

- **Backwards compatibility**: an existing API endpoint's request shape and
  success-response shape MUST NOT change in a backwards-incompatible way within
  a feature PR. Additive changes (new optional fields, new endpoints) are
  permitted; renames, removals, and type changes on existing fields are not
  without a migration path documented in the PR.
- **Shape consistency**: new endpoints MUST follow the existing conventions —
  path prefix `/api/{resource}`, standard CRUD verbs (`POST`, `GET`, `PATCH`,
  `DELETE`), Pydantic request/response schemas under `backend/app/schemas/`,
  JWT auth via the existing `get_current_user_id` dependency.
- **Error-shape parity**: when two endpoints can fail for the same business
  reason (e.g., the 15-minute gap conflict on both `POST /api/posts` and
  `POST /api/series`), they MUST return the same JSON error shape so the
  frontend can share a single error-handling code path.
- **UX vocabulary**: terminology MUST be the same across backend, API, and UI
  for the same concept. "Series" on the backend is "Series" in the UI —
  never "Campaign", "Plan", or "Schedule" for the same thing.
- **Frontend error handling**: the UI MUST surface the server's `detail.message`
  verbatim for server-originated 4xx errors rather than replacing with generic
  copy (this coordinates with Principle VII).

**Rationale**: Consistency is a form of documentation. When the third, fourth,
and fifth endpoints follow the same shape and the UI handles them all the same
way, a reviewer can extrapolate from one example. Breaking that rhythm forces
per-endpoint study and hides bugs in the divergence.

## Technical Constraints

- **Runtime**: Python 3.9+ (backend), Node.js with Vite 7 (frontend).
- **Persistence**: SQLite via SQLAlchemy async. Schema changes MUST be additive
  where feasible; migrations MAY be handled by dropping the dev DB and re-seeding,
  but the seed script (`backend/scripts/seed_data.py`) MUST still run cleanly.
- **Auth**: Existing JWT + bcrypt flow is authoritative. All new endpoints that
  mutate user-owned data MUST require the existing auth dependency.
- **API surface**: New endpoints SHOULD live under `backend/app/api/` and be
  registered in the existing router wiring. Response shapes MUST use Pydantic
  schemas in `backend/app/schemas/`.
- **Frontend**: New pages MUST be added through the existing React Router
  configuration and MUST respect `ProtectedRoute` for authenticated views.

## Delivery Workflow

- Work MUST occur on a feature branch created from `main`; direct commits to `main`
  are disallowed.
- The deliverable is a Pull Request into the candidate's own `main` branch.
- PR description MUST contain the five elements from Principle V.
- Before opening the PR, the candidate MUST run both test suites locally
  (`pytest` in `backend/`, `npm run test` in `frontend/`) and MUST report any
  intentionally skipped or failing tests in the PR description.
- Seed-data smoke check: `python backend/scripts/seed_data.py` followed by a manual
  login as a seeded user SHOULD be performed at least once before submission.
- Before `/speckit-tasks` or `/speckit-implement` runs for any feature, Principle
  VI's detection + halt + ask cycle MUST have been executed against that feature's
  artifacts (spec, plan, research, data-model, contracts). If the most recent
  `/speckit-analyze` or `/speckit-clarify` run reported unresolved items, they MUST
  be resolved before proceeding.
- For features that introduce new or changed backend API endpoints, the task list
  MUST interleave test tasks before their corresponding implementation tasks, per
  Principle IX. The PR diff MUST demonstrate the test-before-code ordering
  (either via a pre-implementation commit with failing tests, or via an explicit
  commit-message note).
- For features that ship UI, a manual smoke run MUST verify: (a) happy path,
  (b) at least one failure path (e.g., a 409 triggering an error toast),
  (c) empty-state rendering, and (d) the destructive-action confirmation dialog
  (per Principle VII).

## Governance

This constitution supersedes ad-hoc preferences for this take-home. All changes
under this repository are reviewed against these principles:

- Any PR that violates **Principle III** (scheduling invariant) is blocked
  regardless of other merits.
- Any PR that introduces or changes backend API endpoints without complying with
  **Principle IX** (Test-First) is blocked — unless the grandfather clause in
  Principle IX's body applies and is explicitly invoked in the PR description.
- Any feature advanced to `/speckit-tasks` or `/speckit-implement` with known
  unresolved conflicts violates **Principle VI** and MUST be reverted to the
  earlier phase until the conflicts are resolved. This blocking behavior applies
  during agent execution as well as during PR review.
- Deviations from Principles I, II, IV, V, VII, VIII, or X MUST be called out
  explicitly in the PR description with justification; unjustified deviations
  are treated as correctness failures.
- Amendments to this constitution require editing this file, incrementing the
  version per semantic-versioning rules below, and updating the Last Amended date.
- Versioning:
  - **MAJOR**: removing or redefining a principle, or changing a NON-NEGOTIABLE.
  - **MINOR**: adding a new principle, materially expanding an existing one, or
    narrowing a principle's scope when the narrower scope is still consistent
    with its original intent.
  - **PATCH**: clarifications, wording fixes, non-semantic refinements.

Runtime development guidance lives in `CLAUDE.md` and `readme.md`; when those
conflict with this constitution, this constitution wins.

**Version**: 1.2.0 | **Ratified**: 2026-04-22 | **Last Amended**: 2026-04-22
