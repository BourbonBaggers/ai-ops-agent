# TEM Runbook

## Local Dev
1) Start local server:
   - `wrangler dev`
2) Test endpoints on:
   - `http://localhost:8787`

## Database
- Apply migrations locally:
  - `wrangler d1 migrations apply <db_name> --local`
- Apply migrations to remote:
  - `wrangler d1 migrations apply <db_name>`
- Run ad-hoc SQL locally:
  - `wrangler d1 execute <db_name> --local --command "SELECT 1;"`

## Environments
- ENVIRONMENT var controls dev-only endpoints (seed).
- Never run seed scripts against production unless intentionally doing a controlled backfill.

## Weekly Operation (Target)
- Friday 09:00: system generates 3 candidates.
- Operator reviews/edits (optional).
- Tuesday 09:45: lock chosen candidate (fallback to #1).
- Tuesday 10:00: send to active contacts.
- Post-send: verify send status + tracking counts.

## Incident Handling (MVP)
- If send fails mid-batch: resume without double-send.
- If tracking breaks: send still proceeds; log that tracking is degraded.
- If admin auth misconfigured: fix Access policy first; validate with /debug/whereami and /health.