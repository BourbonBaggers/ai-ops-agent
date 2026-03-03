# Contributing

## Scope
This project is a Cloudflare Worker + D1 pipeline for weekly email generation and delivery.
Contributions should prioritize deterministic behavior, idempotency, and operational clarity.

## Local Setup
1. Install dependencies:
```bash
npm install
```
2. Create local env file:
- Copy `.dev.vars.example` to `.dev.vars`
- Fill required values (never commit secrets)
3. Apply local migrations:
```bash
wrangler d1 migrations apply <db_name> --local
```
4. Run tests:
```bash
npm test
```
5. Run local worker (optional):
```bash
wrangler dev
```

## Useful Commands
- Preview OpenAI candidates:
```bash
npm run preview:openai
```
- Preview merged HTML templates:
```bash
npm run preview:template
```
- Export image CSV seed:
```bash
npm run images:export
```
- Import curated image CSV:
```bash
npm run images:import -- --file ~/Downloads/email_images_seed_YYYYMMDD_HHMMSS.csv
```

## Code Conventions
- Use ESM modules (`type: module`).
- Prefer deterministic logic over randomness.
- Preserve idempotency for scheduled/send flows.
- Keep route behavior explicit and fail fast on invalid input.
- Avoid adding heavy dependencies unless necessary.
- Keep changes scoped; do not refactor unrelated files in the same PR.

## Data and Security Rules
- Never commit secrets (`.dev.vars` is local-only).
- Use `.dev.vars` for local dev; production config must come from Worker env/secrets.
- Treat contact data and delivery logs as sensitive.
- Do not add logs that dump full request bodies or secret values.

## Database and Migrations
- All schema changes must be additive via `migrations/*.sql`.
- Do not rewrite old migrations.
- Update tests when schema/behavior changes affect pipeline stages.

## Testing Expectations
- Add/adjust tests for any behavioral change in:
  - candidate generation,
  - send-stage idempotency,
  - DRY_RUN behavior,
  - image catalog upload/selection.
- Tests should be deterministic and not rely on real external APIs.

## Pull Request Checklist
- [ ] Changes are scoped and intentional.
- [ ] Tests pass locally (`npm test`).
- [ ] Any new env vars are documented in `.dev.vars.example`.
- [ ] Docs are updated if behavior or operations changed (`docs/runbook.md`, `docs/security.md`, etc.).
- [ ] No secrets, local policy/template files, or personal data are included.
