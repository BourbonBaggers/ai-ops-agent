# Decisions Log

This file records major architecture/product decisions that are currently reflected in code.

## 2026-02-17
- Runtime and data: Cloudflare Worker + D1 (see `src/index.js`, `migrations/`).
- Scheduling model: cron invokes `/jobs/tick`, and tick drives generate/lock/send transitions (see `src/routes/jobs.js`).
- Transport provider: Microsoft Graph in production path via `graphSendMail` (see `src/lib/ms_graph.js`, `src/routes/jobs.js`).
- LLM provider abstraction kept, with active generation path using `OpenAIProvider` (see `src/providers/openaiProvider.js`, `src/routes/candidates.js`).

## 2026-02-25
- Candidate contract normalized to HTML + text multipart fields: `body_html` and `body_text`, plus template action-section fields (`action_line`, `quote_text`, `rally_line`).
- Funnel-stage contract made explicit and enforced at generation time: exactly one `top`, one `mid`, one `bottom` before DB insert (`validateFunnelDistribution` in `src/routes/candidates.js`).
- Template merge token contract centralized in `mergeCandidateIntoTemplate` (`src/lib/template_merge.js`).

## 2026-02-26
- Image source for candidate generation moved from R2 listing endpoint to curated D1 catalog table `email_images`.
- Admin image management uses CSV full-overwrite workflow (`/admin/email_images/upload`) and read endpoint (`/admin/email_images`).
- OpenAI image selection constrained to URL values present in `email_images`; invalid model output is nulled, not fatal.

## 2026-03-01
- Send-stage segmentation uses deterministic salted hash by `weekly_run.week_of` for 3:1 skew and weekly rotation (`src/lib/segmentation.js`).
- Per-contact delivery audit introduced with idempotent unique key on send artifact + contact (`send_deliveries`).
- Batch summary/audit added in `run_log`, including DRY_RUN-aware counts (`migrations/0009_add_send_deliveries_and_run_log.sql`, `migrations/0010_add_run_log_dry_run_count.sql`).

## 2026-03-03
- DRY_RUN is an env-controlled send-stage mode (`DRY_RUN` in worker env): records deliveries as `dry_run`, skips Graph API calls, preserves idempotency and summary logging.
- Local development convention: use `.dev.vars`; production values come from Cloudflare Worker env/secret bindings.
