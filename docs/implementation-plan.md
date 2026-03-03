# Implementation Plan

This plan reflects the current repo state and the next practical milestones.

## Current State (Implemented)
1. Worker + D1 foundation
- Worker routing and scheduled entrypoint are active (`src/index.js`, `src/router.js`, `src/routes/jobs.js`).
- Schema is migration-managed through `migrations/0001` to `0010`.

2. Tuesday pipeline stages
- Generate: `/admin/candidates/generate` and scheduled tick call `generateCandidatesForWeek` (`src/routes/candidates.js`).
- Lock: `lockWeeklyRun` (`src/routes/jobs.js`).
- Send: `sendWeeklyRun` with per-contact selection and delivery logging (`src/routes/jobs.js`).

3. OpenAI generation path
- `OpenAIProvider` is active provider in generation flow (`src/providers/openaiProvider.js`).
- Strict JSON parse and normalized output contract are enforced.
- Funnel validation currently hard-fails unless batch is exactly 1 top / 1 mid / 1 bottom (`src/routes/candidates.js`).

4. Curated image catalog
- Curated image source is D1 table `email_images`, not R2 listing for provider selection.
- Admin endpoints exist for list and CSV full-overwrite upload (`src/routes/email_images.js`).
- Export/import scripts exist (`scripts/images_export_csv.mjs`, `scripts/images_import_csv.mjs`).

5. Template preview tooling
- Candidate-to-template merge utility exists (`src/lib/template_merge.js`).
- Local preview scripts generate candidate JSON and merged HTML files (`scripts/openai_preview.mjs`, `scripts/merge_template_preview.mjs`).

6. Delivery, idempotency, and run logging
- Production send path uses Microsoft Graph (`src/lib/ms_graph.js`).
- Per-contact idempotency/audit: `send_deliveries`.
- Batch summary: `run_log` including DRY_RUN-aware counters.

## Near-Term Plan (Public Backlog)
1. Documentation cleanup and consistency
- Keep README/docs aligned with active routes, env vars, and scripts.
- Maintain public-safe example docs/templates while keeping private policy/template files gitignored.

2. Operational hardening
- Add/expand smoke tests for end-to-end local runbook steps (generate -> lock -> send/dry-run).
- Improve error rollups in run logs for operational triage.

3. Admin ergonomics
- Add lightweight diagnostics endpoint(s) for quick weekly-run health checks.
- Expand image catalog validation feedback for upload errors.

4. Template and content quality guardrails
- Increase validation around required merge tokens and candidate field completeness.
- Add deterministic checks for multipart equivalence (HTML/text intent parity).

## Out of Scope (Not Planned Here)
- CRM features, campaign editor UI, or complex taxonomy systems.
- DB redesign or non-additive schema churn.
- Replacing the current scheduler model.
