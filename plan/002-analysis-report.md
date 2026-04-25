# /speckit-analyze Report — 002-content-series

**Generated**: 2026-04-22
**Constitution version at time of analysis**: v1.2.0 (10 principles)
**Artifacts scanned**: `specs/002-content-series/spec.md`,
`specs/002-content-series/plan.md`, `specs/002-content-series/tasks.md`,
plus cross-referenced `data-model.md`, `contracts/series-api.md`,
`contracts/scheduling-invariant.md`.

This report is **read-only** — no source files were modified during its
generation.

## Remediation status (2026-04-22, applied post-analysis)

After the initial report, the user approved remediations for I1, I2,
I3, I7, I8. Those have been applied — see the per-finding **Resolution**
notes in the table below. I4, I5, I6, I9 remain open but are explicitly
tagged as "address inline during implementation" in the recommendations.

| ID | Severity | Status |
| --- | --- | --- |
| I1 | MEDIUM | ✅ Applied (spec.md FR-011 amended) |
| I2 | MEDIUM | ✅ Applied (tasks.md T023 rewritten — Edit button hidden for v1) |
| I3 | LOW | ✅ Applied (tasks.md T016 pins `generate_schedule` to `scheduling.py`) |
| I4 | LOW | ⏭ Deferred to implementation-time decision |
| I5 | LOW | ⏭ Deferred — implementer picks option (a) or (b) |
| I6 | LOW | ⏭ Deferred — one-line note can be added inline |
| I7 | LOW | ✅ Applied (tasks.md T013 changed 409 → 400) |
| I8 | LOW | ✅ Applied (spec.md FR-018a added binding Principle VII) |
| I9 | LOW | ⏭ Deferred to implementation-time decision |

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|---|---|---|---|---|---|
| I1 | Inconsistency | **MEDIUM** | `spec.md` FR-011 ↔ `data-model.md` §8 ↔ `contracts/series-api.md` ↔ `tasks.md` T014 | The design and tests reference an optional `series_post_index` field in the 409 body on the series-create path, but FR-011 (even after Clarify-Q3 amendment) doesn't enumerate that field. Risk: implementer assumes it's optional and skips it; tests in T014 then fail. | Add a half-sentence to FR-011: *"On the series-create path, the same body MAY also include `series_post_index` (0-indexed position of the would-be series post that triggered the conflict)."* |
| I2 | Underspecification | **MEDIUM** | `tasks.md` T023 | "Edit series" button on `SeriesDetail.jsx` is left as *"link to a future `/series/${id}/edit` page or hide if not implemented"* — implementer's choice. Two valid behaviors, different UX. | Decide now: **hide** the button for v1 (SeriesEdit.jsx is create-only per T022; FR-005 only allows editing title/description, which would need a tiny EditSeries form not in scope). Update T023. |
| I3 | Underspecification | LOW | `tasks.md` T016 | T016 leaves the location of `generate_schedule` open: *"Create `backend/app/core/series_schedule.py` (or co-locate ... inside `series.py` if you prefer)"*. | Pin one: place `generate_schedule` in `backend/app/core/scheduling.py` next to `check_platform_gap` (cohesion: both are scheduling math). Remove the OR. |
| I4 | Ambiguity | LOW | `spec.md` FR-011 ↔ `data-model.md` §7 | `delta_minutes` type unspecified in FR-011. `data-model.md` says `float`. The frontend toast might surface "0.5 minutes" or "7.3 minutes" and look odd. | Either fix the type to `int` (rounded) in FR-011 or note that the frontend renders as rounded integer for display. |
| I5 | Coverage gap (minor) | LOW | spec Edge Case "Cadence too dense" + `tasks.md` T014 | The pairwise sibling check in series-create is unreachable from valid Pydantic input (min 1-day cadence ≫ 15 min). T014's test list does not include a "cadence too dense" case, so the defensive code path is untested. | Either (a) add a `test_create_series_pairwise_check_via_direct_injection` case to T014 that monkeypatches `generate_schedule` to produce close timestamps, or (b) remove the defensive sibling check and rely on Pydantic bounds. Option (b) is simpler. |
| I6 | Coverage gap | LOW | `spec.md` FR-005a ↔ `tasks.md` | FR-005a has tests in T012 (PATCH ignores `series_id` / `series_position`) but no explicit IMPL task — it's auto-satisfied by `PostUpdate` schema absence (T007). Implementer might wonder "where's the code?" | Add a one-line note to T012: *"FR-005a is satisfied for free by `PostUpdate` not declaring those fields (per T007 schema design); these tests guard against future regressions."* |
| I7 | Inconsistency | LOW | `tasks.md` T013 | T013 says raise `HTTPException(409, ...)` for FR-005b platform-change rejection. Mixing 409 with the platform-gap conflict (also 409) is confusing for the frontend error handler that switches on `detail.error`. | Use **400** for FR-005b (it's a validation rule, not a scheduling collision). Reserve 409 for `platform_gap_conflict`. |
| I8 | Constitution alignment | LOW | spec FR block ↔ Constitution Principle VII | Principle VII enumerates four UI mandates (loading, error message verbatim, empty state, destructive confirm). Tasks T021–T023 + T031 cover them, but no FR names them, so a reviewer reading only the spec could miss them. | Add FR-018a: *"Frontend MUST honor Constitution Principle VII for the new series pages: loading state, error toast surfacing server `detail.message`, empty state with call-to-action, destructive-action confirmation dialog."* |
| I9 | Underspecification | LOW | `data-model.md` §3 invariant + spec | Data-model states "`series_id IS NULL` iff `series_position IS NULL` (enforced in code, not DB)" but no FR or test covers this code-level invariant. | Either add a test in T014 (`test_series_post_position_is_zero_indexed_and_contiguous`) or accept that `POST /api/series` is the only writer and naturally enforces it; document the latter as the deliberate choice. |

**None** at HIGH or CRITICAL severity.

## Coverage Summary

| Requirement | Has Task? | Task IDs | Notes |
|---|---|---|---|
| FR-001 (create series) | ✅ | T014, T015, T017 | |
| FR-002 (materialize N posts) | ✅ | T014, T015 | |
| FR-002a (auto-titles) | ✅ | T014, T015 | |
| FR-003 (atomic persistence) | ✅ | T014, T015 | |
| FR-004 (list + get) | ✅ | T018, T019 | |
| FR-005 (edit metadata, frozen titles) | ✅ | T018, T019 | |
| FR-005a (PATCH cannot mutate series fields) | ⚠ tests only | T012 | Implicit IMPL via T007 — see I6 |
| FR-005b (PATCH platform reject on series posts) | ✅ | T012, T013 | See I7 (status code) |
| FR-006 (cascade delete incl. published) | ✅ | T018, T019 | |
| FR-007 (ownership scoping) | ✅ | T018, T019 | |
| FR-008 (15-min rule, all statuses) | ✅ | T008, T009, T010, T011 | |
| FR-009 (exact-15-min boundary accept) | ✅ | T008 | |
| FR-010 (backend enforcement on all paths) | ✅ | T009, T011, T015 | |
| FR-011 (409 shape) | ⚠ partial | T010, T014 | See I1 (`series_post_index` missing from FR text) |
| FR-012 (drafts exempt) | ✅ | T008 | |
| FR-013 (PATCH self-exclusion) | ✅ | T010 | |
| FR-014 (Series entity) | ✅ | T002, T006 | |
| FR-015 (Post additions) | ✅ | T003, T007 | |
| FR-016 (idempotent migration) | ✅ | T005 | |
| FR-017 (PostResponse exposes series fields) | ✅ | T007 | |
| FR-018 (UI for CRUD) | ✅ | T021, T022, T023 | See I8 (Principle VII not in FR) |
| FR-019 (existing pages still work; series surface) | ✅ | T026; Calendar untouched | |
| FR-020 (cadence preview before submit) | ✅ | T022 | |

**Coverage**: 23 / 23 FRs mapped to tasks (100%). Two with caveats
(FR-005a implicit IMPL; FR-011 missing optional field).

## Constitution Alignment

| Principle | Status |
|---|---|
| I — Extend, Don't Rewrite | ✅ Tasks add new files, modify only necessary lines of existing files |
| II — Stay on the Existing Stack | ✅ No new runtime deps |
| III — Enforce Scheduling Invariants (NON-NEGOTIABLE) | ✅ Phase 3 fully covers; tests for within-window AND exact-boundary |
| IV — Pragmatic Test Coverage | ✅ Frontend tests pragmatic (T027 optional) |
| V — Clear Structure | ✅ Tasks reference exact file paths |
| VI — Resolve Spec Conflicts at Gates (NON-NEGOTIABLE) | ✅ Tasks-Q1 halt-and-asked at `/speckit-tasks` gate |
| VII — User-Friendly UI | ⚠ Compliance lives in tasks T021–T023 + T031, not in any FR — see I8 |
| VIII — Code Quality | ✅ T033 audit step |
| IX — Test-First for Backend API (NON-NEGOTIABLE) | ✅ Five `[TF]` cycles cover all in-scope code |
| X — API Compatibility & UX Consistency | ✅ T015 explicitly mentions shared `_conflict_409` helper; `PostResponse` additions are additive |

**Zero constitution violations.** Two principles (VII, IX) are honored at
the task level rather than the FR level — only VII is flagged as a
worth-fixing finding (see I8). IX's task-level enforcement is the whole
point of IX and needs no FR mirror.

## Unmapped Tasks

**None.** Every task either implements an FR or fulfills a setup /
polish / constitution obligation. Full task-to-obligation map:

- T001 — Setup
- T002–T007 — Foundational (FR-014 / FR-015 / FR-016 / FR-017)
- T008–T013 — US2 (FR-005a/b, FR-008–FR-013)
- T014–T017 — US1 backend (FR-001 → FR-004, FR-011)
- T018–T019 — US3 backend (FR-004 → FR-007)
- T020–T026 — Frontend (FR-018, FR-019, FR-020)
- T027 — Optional Vitest coverage (Principle IV pragmatic)
- T028 — Readme update (Principle V)
- T029, T030 — Test/build green gate (Principle IV/IX)
- T031 — UI smoke (Principle VII)
- T032 — Optional seed enrichment
- T033 — Code-quality audit (Principle VIII)
- T034 — PR description (Principle V)
- T035 — Push + verify CI green
- T036 — Loom (Principle V)

## Metrics

| Metric | Value |
|---|---|
| Total Requirements | 23 FRs |
| Total Tasks | 36 |
| Coverage % (FRs with ≥ 1 task) | 100% |
| Ambiguity Count | 4 (I1, I3, I4, I9) |
| Duplication Count | 0 |
| Critical Issues Count | 0 |
| Constitution Violations | 0 |

## Next Actions

No CRITICAL or HIGH findings. The spec/plan/tasks set is ready for
`/speckit-implement` as-is. Two MEDIUM items are worth fixing first
because they would otherwise surface during implementation as small
ambiguities the implementer must resolve mid-flight:

- **I1** — document the optional `series_post_index` field on FR-011.
- **I2** — hide the "Edit series" button in T023 (don't leave the OR).

Low-priority items (I3, I4, I5, I6, I7, I8, I9) can be addressed during
implementation without meaningful risk.

Suggested fix order (cheapest → most valuable):

1. **I7** — one-line change in T013: `409` → `400` for platform-change rejection.
2. **I1** — one sentence in spec FR-011: document optional `series_post_index`.
3. **I2** — one line in T023: hide the Edit-series button for v1.
4. **I3** — one line in T016: co-locate `generate_schedule` in `scheduling.py`.
5. **I8** — new FR-018a: explicitly bind Principle VII to the spec.
6. **I4, I5, I6, I9** — minor; address inline during implementation.

### Suggested command sequence

- To apply the recommended edits: ask the agent to "apply remediation for I1, I2, I7, I8" and it will edit only the named files.
- To proceed without remediation: run `/speckit-implement`. Principle VI's gate-check at that step will re-scan; the MEDIUM items will re-surface as small `tasks.md` ambiguities for the implementer to decide at execution time.

## Session context

This analysis was requested via `/speckit-analyze` after the
`/speckit-tasks` run on 2026-04-22 that produced the initial 36-task
list, and after the `/speckit-constitution` amendment that introduced
Principles VII, VIII, IX, and X (v1.2.0). It reflects the *current*
state of `specs/002-content-series/` as of that time, not a frozen
snapshot.
