# AI Ops Agent (Reference Implementation: "Courtney")

## 1. Purpose

Build a serverless AI operator that reliably produces and sends one scheduled outbound email to a defined contact group each week. The system must minimize ongoing costs, preserve full history, enforce governance controls, and support chat-driven CRUD updates.

## 2. Goals

* **One weekly send**: Tuesday **10:00 AM** (configurable timezone).
* **Idea generation**: Friday **9:00 AM** the system generates **3 candidate emails**.
* **Lock time**: Tuesday **9:45 AM** content is locked. If no selection/feedback is provided, candidate **#1** is used as-is.
* **Reply-to**: configurable mailbox.
* **Privacy**: recipients must not see each other (no CC/BCC list exposure). Use individual sends.
* **Tracking** (priority order): **Opens**, **Bounces**, **Unsubscribe**, **Clicks**.
* **History**: store all sent emails permanently; support retrieval and reuse.
* **Chat-first input**: updates and CRUD actions primarily via chat; minimal dashboards for viewing lists/history.
* **Cost discipline**: run serverless with strict LLM budget controls.

## 3. Non-Goals (MVP)

* Segmentation/personalization beyond identical content to all recipients.
* CRM pipeline or performance analytics.
* Multi-channel orchestration beyond designing for future add-on (e.g., SMS).
* Complex campaign automation.

## 4. Users & Roles

* **Admin/Operator**: defines marketing standards, updates calendar, approves/modifies weekly content, manages contact list.
* **System**: generates candidates, queues selected email, sends at scheduled time, logs outcomes, collects tracking.

## 5. Core Artifacts

### 5.1 Contact List

**NOTE:** All data structures must remain compatible with HubSpot CRM import/export conventions to ensure future migration and interoperability.

Fields (minimum):

* firstname
* lastname
* email
* phone
* address_line1
* address_line2 (nullable)
* city
* state
* zip
* contact_group (e.g., "Group A" | "Group B")
* status (active/inactive)

Initial load: CSV upload. Ongoing: chat-driven CRUD.

### 5.2 Marketing Standards Policy (Single Doc)

A persistent “constitution” the system must not violate, including:

* tone/style rules
* subject line and preview hook intensity guidance
* forbidden phrases
* formatting rules (e.g., no emojis, no em dashes)
* required permanent sections
* image rules (allowed sources defined by configuration)
* compliance constraints (e.g., never discuss pricing)

### 5.3 Marketing Calendar (1–3 month horizon)

Structured dated items used to inform weekly content:

* trade shows
* holidays
* product launches
* availability changes

System may suggest additions. Only Tuesday send is auto-authorized on inaction.

### 5.4 Weekly Send Package

For each scheduled send:

* subject line
* preview text (preheader)
* rendered HTML + plain text
* optional image references
* tracking IDs
* send status + timestamps
* per-recipient delivery result
* internal archive copies sent to configurable internal mailboxes

## 6. Workflow

### 6.1 Setup

1. Admin uploads CSV of contacts.
2. Admin creates/edits Marketing Standards Policy.
3. Admin seeds Marketing Calendar.

### 6.2 Weekly Cadence

**Friday 9:00 AM**

* System generates 3 candidates (subject + preview text + body + CTA + optional image guidance).
* Delivered via chat interface and optional email summary.

**Friday → Tuesday 9:45 AM**

* Admin may provide free-text edits.
* Admin may update calendar or add weekly focus notes.

**Tuesday 9:45 AM (lock)**

* If a candidate is selected/edited, lock that.
* Otherwise lock candidate #1.

**Tuesday 10:00 AM (send)**

* System sends individual emails to all active contacts.
* Sender mailbox: configurable.
* Reply-to: configurable.

### 6.3 Post-Send

* Log send completion
* Log bounces (from provider signals)
* Log opens/clicks (via tracking endpoints)
* Log unsubscribes
* Preserve full send history

## 7. Functional Requirements

### 7.1 Candidate Generation

* Produce 3 candidates weekly.
* Each candidate must include:

  * subject
  * preview_text
  * body
  * CTA
* Must comply with Standards Policy.
* Must consider upcoming calendar items.

**Preference Learning (MVP)**

* No implicit model training.
* Improve outputs by including:

  * selected candidate history
  * admin edits
  * lightweight quality labels
* Weekly generation prompt includes compact preference summary + examples.

### 7.2 Selection & Editing

* Accept free-text instructions.
* Maintain audit trail of:

  * original candidates
  * edits
  * final locked version

### 7.3 Sending

* Individual messages only.
* Archive copies to configurable internal mailboxes.
* Support scheduled weekly send.

### 7.4 Tracking

Priority:

1. Opens
2. Bounces
3. Unsubscribe
4. Clicks

Tracking via dedicated subdomain (e.g., `track.example.com`).

### 7.5 History & Retrieval

* Store all sends permanently.
* Support retrieval by date and reuse.

### 7.6 Contact CRUD (Chat-driven)

* Add contact
* Update contact
* Deactivate/reactivate contact
* Bulk import via CSV

## 8. UI/UX Requirements

### 8.1 Minimal Dashboards

* Send history list
* Calendar list
* Contact list
* Candidate review screen

### 8.2 Chat Interface

Primary control surface for:

* editing standards
* adding calendar items
* selecting/editing candidates
* contact CRUD

## 9. Technical Strategy (MVP)

### 9.1 Hosting

* Cloudflare Workers (serverless)
* Cloudflare D1 (database)
* Cron triggers for scheduling

### 9.2 Sending Method

* Microsoft 365 via Graph API (initial provider)

### 9.3 Tracking Subdomain

* Dedicated subdomain (e.g., `track.example.com`)
* Endpoints:

  * `/t/open/:token.png`
  * `/t/click/:token`
  * `/t/unsub/:token`

### 9.4 LLM Usage

* Hybrid, cost-conscious
* API-based generation with strict budget limits
* Provider abstraction layer to allow future model swaps

## 10. Security & Compliance

* Database contains PII (names, emails, phone, address).
* Admin endpoints protected via Zero Trust access.
* Secrets stored as environment secrets only.
* No PII in tracking URLs.
* Opaque signed tokens for tracking.
* Optional application-layer encryption for sensitive fields.
* Full audit log of generation, edits, sends, tracking events.

## 11. Reliability

* Best-effort acceptable.
* Retry transient send failures.
* Avoid duplicate sends.

## 12. Future Enhancements

* Segmented sends
* Personalization tokens
* SMS transport provider
* A/B testing

## 13. Implementation Plan (High-Level)

1. Create Cloudflare Worker + D1 database
2. Implement contact schema + migrations
3. Implement tracking endpoints with signed tokens
4. Integrate model provider (OpenAI initial)
5. Integrate transport provider (Graph email)
6. Implement weekly cron jobs
7. Add minimal web UI (chat + history)
8. Add cost guardrails and audit logging
