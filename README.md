# ai-ops-agent (Courtney)

A governance-first, serverless AI operator that:
- generates weekly outbound email candidates,
- supports human approval or auto-default selection,
- sends via Microsoft 365 (Graph),
- tracks opens/clicks/unsubs,
- preserves full send history,
- runs on Cloudflare Workers with strict cost controls.

Reference implementation: “Courtney” (AI employee) for Bourbon Baggers.

# Documentation

- `brd.md` — business requirements and behavior
- `implementation-plan.md` — build plan and sequencing
- `security.md` — PII threat model and protections
- `operations.md` — how to run and troubleshoot
