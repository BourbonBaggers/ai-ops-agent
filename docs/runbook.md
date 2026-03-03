# Runbook

## Purpose
Operate the weekly generate/lock/send pipeline locally and in deployed environments with deterministic, idempotent behavior.

## Prerequisites
1. Node.js 20+ and Wrangler installed.
2. `.dev.vars` present (copy from `.dev.vars.example` and fill values).
3. D1 database configured in Wrangler.

## Required Environment Variables
- Core:
  - `ENVIRONMENT` (`dev` locally)
  - `TIMEZONE`
  - `SCHEDULE_GENERATE_DOW`, `SCHEDULE_GENERATE_TIME`
  - `SCHEDULE_LOCK_DOW`, `SCHEDULE_LOCK_TIME`
  - `SCHEDULE_SEND_DOW`, `SCHEDULE_SEND_TIME`
- Generation:
  - `OPEN_AI_KEY`
  - `OPENAI_MODEL` (optional override)
- Send:
  - `GRAPH_TENANT_ID`
  - `GRAPH_CLIENT_ID`
  - `GRAPH_CLIENT_SECRET`
  - `GRAPH_SENDER_EMAIL`
  - `REPLY_TO`
  - `DRY_RUN` (`true`/`1` for safe non-delivery runs)

## Local Setup
1. Apply migrations locally:
```bash
wrangler d1 migrations apply <db_name> --local
```
2. Start Worker locally:
```bash
wrangler dev
```
3. Health check:
```bash
curl -s http://127.0.0.1:8787/health
```

## Common Workflows
1. Generate OpenAI candidates preview (no scheduler):
```bash
npm run preview:openai
```
2. Generate merged HTML previews from template:
```bash
npm run preview:template
```
3. Export seed image CSV from R2 listing:
```bash
npm run images:export
```
4. Import curated image CSV to D1 `email_images` (full overwrite):
```bash
npm run images:import -- --file ~/Downloads/email_images_seed_YYYYMMDD_HHMMSS.csv
```

## Pipeline Entry Points
1. Scheduled entrypoint:
- Worker `scheduled()` calls `POST /jobs/tick` internally (`src/index.js`).
2. Manual tick:
```bash
curl -s -X POST http://127.0.0.1:8787/jobs/tick
```
3. Dev full-run helper (generate -> lock -> send):
```bash
curl -s -X POST "http://127.0.0.1:8787/dev/run?week_of=YYYY-MM-DD&force=1&reset=1"
```
4. Manual generation endpoint:
```bash
curl -s -X POST "http://127.0.0.1:8787/admin/candidates/generate?week_of=YYYY-MM-DD&force=1"
```
5. Manual candidate selection endpoint:
```bash
curl -s -X POST http://127.0.0.1:8787/admin/candidates/select \
  -H "content-type: application/json" \
  -d '{"week_of":"YYYY-MM-DD","rank":2}'
```

## DRY_RUN Operations
1. Set in `.dev.vars`:
```dotenv
DRY_RUN=true
```
2. Run send stage via `/dev/run` or `/jobs/tick`.
3. Expected behavior:
- No Microsoft Graph API calls.
- `send_deliveries.status = "dry_run"` for newly attempted rows.
- `run_log.dry_run = 1` and `dry_run_count` populated.

## Verification Checks
1. Check weekly run state:
```bash
wrangler d1 execute <db_name> --local --command "SELECT id, week_of, status, generated_at, locked_at, sent_at FROM weekly_runs ORDER BY created_at DESC LIMIT 5;"
```
2. Check generated candidates:
```bash
wrangler d1 execute <db_name> --local --command "SELECT weekly_run_id, rank, funnel_stage, subject FROM candidates ORDER BY created_at DESC LIMIT 20;"
```
3. Check send artifacts and per-contact deliveries:
```bash
wrangler d1 execute <db_name> --local --command "SELECT weekly_run_id, candidate_id, COUNT(*) as deliveries FROM send_deliveries GROUP BY weekly_run_id, candidate_id ORDER BY weekly_run_id DESC LIMIT 20;"
```
4. Check run summaries:
```bash
wrangler d1 execute <db_name> --local --command "SELECT weekly_run_id, dry_run, contacts_total, attempted, dry_run_count, sent_success, failed, skipped_already_sent FROM run_log ORDER BY started_at DESC LIMIT 20;"
```

## Incident Handling
1. Graph send failures:
- Pipeline records per-contact `failed` rows with error message.
- Other contacts continue processing.
- Re-run is idempotent; already delivered contacts are skipped.
2. Duplicate-send prevention:
- Unique delivery key in `send_deliveries` prevents duplicate rows for same send artifact + contact.
3. Empty/invalid generation:
- Generation fails if provider output is not strict JSON or does not contain exactly 3 candidates in required funnel distribution.
4. Missing mail env vars:
- Send stage fails fast with explicit missing variable error.

## Notes
- Route and response labels may still contain legacy wording like `sent_stub` in some dev responses; operational behavior is governed by the actual send path in `src/routes/jobs.js`.
