# Decisions Log

Keep this short. Each entry is 1–3 lines.

## 2026-02-17
- Hosting: Cloudflare Workers + D1 (serverless-first).
- Admin protection: Cloudflare Zero Trust Access using Service Auth for API testing and user auth for browser access.
- Email transport: Microsoft Graph (provider abstraction required).
- LLM provider: abstracted interface; prompt-level “preference learning” via retrieval from history (no fine-tuning in MVP).
- Tracking: dedicated tracking subdomain routed to same Worker; opaque signed tokens; no PII in URLs.
- DB: schema managed via migrations; seed data via seed scripts or dev-only admin seed endpoint gated by ENVIRONMENT.