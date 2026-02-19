# Copilot instructions for ai-ops-agent

## Non-negotiables
- NEVER invent files, exports, routes, or helpers. If you need something, search the repo first.
- Keep changes minimal. Prefer smallest diff that makes tests pass.
- Run/maintain `npm test`. Do not change tests to match broken behavior unless explicitly instructed.

## Project facts
- Workers app using wrangler/miniflare.
- Time utilities live in `src/lib/time.js`. Do not reimplement date parsing elsewhere.
- Errors: use `badRequest()` / `httpError()` in `src/lib/utils.js`. Prefer throwing these and letting router map them to JSON.
- Admin routes are GET-only unless a POST explicitly exists in router.

## Style
- Use ESM imports/exports.
- All handlers return `json(...)` success or throw typed errors with `.status`.
- Validate query params and JSON bodies explicitly. Empty JSON body must return 400, not 500.

## Testing
- If adding behavior, add/extend tests in `tests/`.
- Prefer black-box tests via HTTP calls to local worker (existing `_helpers.mjs` patterns).