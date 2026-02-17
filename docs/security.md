# Security

## Data classification
- PII: names, emails, phones, postal addresses (stored in D1)

## Access control
- Admin endpoints behind Cloudflare Zero Trust (Access)
- No public admin routes

## Secrets
- Stored only as Worker Secrets (Graph creds, signing keys, LLM keys)
- Never committed to repo

## Tracking privacy
- No PII in URLs
- Signed opaque tokens for open/click/unsub
- Minimal event payload stored

## Logging
- Redact request bodies for chat/admin routes
- Avoid logging PII entirely
