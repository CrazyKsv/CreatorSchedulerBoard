# Specification Quality Checklist: Auto-Publish Flow & Status Transition Lockdown

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-04-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The user prompt named APScheduler / AsyncIOScheduler as a recommended implementation. The spec captures this as an Assumption ("in-process scheduler is acceptable") and as a non-binding note in the user input quote, rather than as a hard requirement, so the planning phase can confirm the library choice without re-litigating the spec.
- Three potentially-uncertain decisions were initially resolved as informed defaults rather than [NEEDS CLARIFICATION] markers:
  1. **Notification channel** → polling (matches existing fetchAll pattern; SSE/WebSocket explicitly out of scope).
  2. **`scheduled_at` mutation on manual publish** → preserved unchanged (planned time = de-facto publish time; schema add deferred).
  3. **`Archived` in dropdown** → kept (user prompt only named `published` and `failed` for removal).
  Each is documented in the Assumptions section so a planner can flip the call if needed.
- The repo has a stale `005-auto-publish-scheduled` branch that may contain prior work toward this feature; the spec is independent of it and the planning phase will decide whether to borrow.

### `/speckit.clarify` session — 2026-04-24

Four clarifications were resolved during the clarification pass and integrated into the spec:

1. **Series sequential dependency** (Q1 → answer **B**): Stage N auto-publishes only after stage N-1 is `published`. Added FR-009a (sequential rule), FR-009b (catch-up on predecessor unblock), FR-015a (manual publish bypasses sequential rule), 2 acceptance scenarios, 2 edge cases, SC-007.
2. **Manual publish confirmation** (Q2 → answer **A**): Confirmation modal required. Added FR-015b, 2 acceptance scenarios, Cancel-prompt edge case.
3. **Internal auto-publish failure** (Q3 → answer **C with user-visibility addendum**): Leave in `scheduled`, rely on catch-up retry, surface a non-blocking "last attempt failed; will retry" annotation to the post owner. Added FR-007a (annotation requirement), FR-007b (auto-clear + persistence), 2 edge cases, SC-008.
4. **Freshness SLO** (Q4 → answer **A**): Keep 60s UI freshness / 30s catch-up. No FR or SC change required (already encoded).
