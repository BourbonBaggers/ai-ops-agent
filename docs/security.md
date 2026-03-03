# Security

This document describes the **current** security posture of this repository as implemented today.

## Security model
- Runtime: Cloudflare Worker + D1.
- Trust boundary: application routes are intended to sit behind Cloudflare Access / edge controls in deployed environments.
- App responsibility: enforce data integrity, idempotency, and safe secret usage; avoid leaking sensitive data in logs.

## Data classification
- **Confidential business content**: policy prompt and generated campaign content.
- **PII**: contact email addresses and related fields in `contacts`, plus recipient email in `send_deliveries`.
- **Operational telemetry**: run-level and delivery-level statuses in `run_log`, `sends`, and `send_deliveries`.

## Access control (implemented vs expected)
- Implemented in code:
  - `src/routes/dev_email.js` requires `x-dev-email-key` matching `env.DEV_EMAIL_KEY`.
  - `src/routes/dev.js` only serves `/dev/*` routes in dev usage patterns.
- Expected at deployment:
  - `/admin/*`, `/jobs/*`, and `/dev/*` should be protected at the edge (Cloudflare Access, service auth, IP policy, or equivalent).
- Important: there is no centralized in-app auth middleware in `src/router.js`; route protection is primarily an infrastructure concern in this codebase.

## Secrets management
- Required sensitive env vars include:
  - OpenAI: `OPEN_AI_KEY`
  - Graph: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER_EMAIL`
  - Optional dev auth: `DEV_EMAIL_KEY`
- Local development uses `.dev.vars`; production should use Cloudflare encrypted secrets/bindings.
- `.dev.vars` is ignored by git; only `.dev.vars.example` is committed.
- No credentials are hardcoded in source files.

## Outbound provider security
- Microsoft Graph token acquisition uses OAuth2 client credentials (`src/lib/ms_graph.js`).
- Access token is cached in-memory with early refresh; token is never persisted to D1.
- Mail send path in `sendWeeklyRun` supports:
  - real send via Graph (`graphSendMail`)
  - deterministic DRY_RUN mode (`DRY_RUN=true`) that records delivery intent without external send.

## Generation and prompt safety controls
- OpenAI provider enforces strict JSON parsing and rejects non-JSON responses (`src/providers/openaiProvider.js`).
- Candidate batch must be exactly 3 items; generation fails otherwise.
- Candidate funnel distribution is validated before DB insert: exactly one `top`, one `mid`, one `bottom` (`src/routes/candidates.js`).
- Image URLs are constrained to curated D1 `email_images`; invalid model-selected image URL is nulled.

## Data integrity and idempotency controls
- Per-contact idempotency is enforced with unique delivery keys in `send_deliveries` (migration `0009_add_send_deliveries_and_run_log.sql`).
- Reruns skip already-recorded deliveries instead of duplicating sends.
- Run-level summary is persisted in `run_log`, including `dry_run`, counts by stage, and error rollups.

## Logging posture
- Current logs include operational summaries and errors (for example, send stage summary in `src/routes/jobs.js`).
- Delivery rows store recipient email for audit/debug; run summary samples use `contact_id` and stage/status.
- Recommendation: treat Worker logs and D1 exports as sensitive because they may include identifiers and failure details.

## Known limitations / hardening backlog
- No first-class app-layer auth/authorization middleware across all admin routes.
- No rate limiting or abuse controls implemented in-route.
- No per-field encryption at rest in application logic (relies on platform controls).
- Tracking endpoints and tokenized open/click/unsubscribe flow are not implemented in current runtime routes; any references elsewhere are forward-looking.

## Operational guardrails
- Use least-privilege Graph app permissions and restrict mailbox scope where possible.
- Rotate Graph client secrets on a defined schedule.
- Keep DRY_RUN enabled for non-production smoke runs.
- Never run local dev endpoints on publicly exposed worker environments without edge auth.
