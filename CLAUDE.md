<!-- SPECKIT START -->
Active feature: `specs/006-auto-publish-flow/` (auto-publish at scheduled time + manual "Publish post" button + status-transition lockdown).
For technical context, project structure, and concrete decisions, read:

- Plan: `specs/006-auto-publish-flow/plan.md`
- Spec (with all Clarifications): `specs/006-auto-publish-flow/spec.md`
- Research (decision log): `specs/006-auto-publish-flow/research.md`
- Data model (schema + state-transition table): `specs/006-auto-publish-flow/data-model.md`
- Contracts: `specs/006-auto-publish-flow/contracts/`
- Quickstart: `specs/006-auto-publish-flow/quickstart.md`
- Source prompt: `scheduler-details/prompt.md`

Prior features: `specs/001-ci-docker-compose/` (merged), `specs/002-content-series/` (merged), `specs/003-content-management/` (CCM frontend port + archival + templated series creation, merged on `ui-reworkd-v2`).
Abandoned but referenced: branch `005-auto-publish-scheduled` — earlier SSE-based attempt at this feature; the current plan borrows its stdlib polling-loop skeleton but drops the SSE / WebSocket layer.
Constitution: `.specify/memory/constitution.md` (v1.2.0, 10 principles;
Principle VI NON-NEGOTIABLE at `/speckit-tasks` and `/speckit-implement`
gates; Principle IX Test-First for backend API NON-NEGOTIABLE).
<!-- SPECKIT END -->
