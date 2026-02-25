# ai-ops-agent (Courtney)

A governance-first, serverless AI operator that:
- generates weekly outbound email candidates,
- supports human approval or auto-default selection,
- sends via Microsoft 365 (Graph),
- tracks opens/clicks/unsubs,
- preserves full send history,
- runs on Cloudflare Workers with strict cost controls.

Reference implementation: “Courtney” (AI agent) for Bourbon Baggers.

# Documentation

- `brd.md` — business requirements and behavior
- `implementation-plan.md` — build plan and sequencing
- `security.md` — PII threat model and protections
- `operations.md` — how to run and troubleshoot

# Curated Email Images

- Export seed CSV from current R2 allowlist: `npm run images:export`
- Upload curated CSV (full overwrite): `npm run images:import -- --file ~/Downloads/email_images_seed_YYYYMMDD_HHMMSS.csv`
- Admin list endpoint: `GET /admin/email_images?limit=200&product_name=Widget%20A`
- Admin upload endpoint: `POST /admin/email_images/upload` with `text/csv` (or `multipart/form-data` with `file` field)
