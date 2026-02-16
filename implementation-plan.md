# Implementation Plan

## Phase 1: Courtney v1 (value-first)
1. Cloudflare Worker skeleton + Zero Trust access
2. D1 schema + migrations
3. Tracking endpoints on `track.*`
4. Weekly cadence jobs (generate/lock/send)
5. Microsoft Graph sender integration
6. Minimal web UI (chat + history views)
7. Preference memory (selection + edits → prompt context)
8. Cost guardrails + audit logging

## Phase 2: Template extraction (after v1 works)
- Provider abstraction hardening
- Generic config + example implementation
- Cleaner docs + diagrams
