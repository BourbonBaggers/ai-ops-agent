Microsoft Graph Setup (App-only) for ai-ops-agent

This is a directional guide for configuring Microsoft Graph using the client credentials (app-only) flow so this Cloudflare Worker can send email.

Assumptions:
	•	You have access to a Microsoft 365 tenant (Entra ID / Azure AD).
	•	You are using application permissions (no interactive login).
	•	Secrets are stored locally in a gitignored .dev.vars file.

⸻

1) Create an App Registration (Entra ID)
	1.	Go to the Microsoft Entra admin center.
	2.	Navigate to App registrations.
	3.	Create a new registration.
	4.	Choose Single tenant (if only used internally).
	5.	Redirect URI is NOT required for client credentials flow.
	6.	Create the app.

Record:
	•	Application (client) ID → MS_CLIENT_ID
	•	Directory (tenant) ID → MS_TENANT_ID

⸻

2) Create a Client Secret
	1.	Open Certificates & secrets.
	2.	Create a new client secret.
	3.	Copy the secret VALUE immediately.

Record:
	•	Secret VALUE → MS_CLIENT_SECRET_VALUE
	•	Secret ID (optional) → MS_CLIENT_SECRET_ID

⸻

3) Add Microsoft Graph Application Permissions
	1.	Go to API permissions.
	2.	Add a permission.
	3.	Select Microsoft Graph.
	4.	Choose Application permissions.
	5.	Add:
	•	Mail.Send

⸻

4) Grant Admin Consent

In API permissions:
	•	Click Grant admin consent for your tenant.

Without this step, Graph calls will fail with 401 or 403.

⸻

5) Choose Sender Mailbox (UPN)

Your code sends via:

POST https://graph.microsoft.com/v1.0/users/{UPN}/sendMail

You must use a valid mailbox user or shared mailbox UPN.

Set:
	•	MAIL_SENDER_UPN = sender@yourdomain.com
	•	REPLY_TO = replyto@yourdomain.com

⸻

6) Configure .dev.vars (gitignored)

Create .dev.vars in repo root:

TIMEZONE=America/Chicago
SCHEDULE_GENERATE_DOW=FRIDAY
SCHEDULE_GENERATE_TIME=09:00
SCHEDULE_LOCK_DOW=TUESDAY
SCHEDULE_LOCK_TIME=09:45
SCHEDULE_SEND_DOW=TUESDAY
SCHEDULE_SEND_TIME=10:00

MS_CLIENT_ID=xxxxxxxx
MS_TENANT_ID=xxxxxxxx
MS_CLIENT_SECRET_VALUE=xxxxxxxx
MS_CLIENT_SECRET_ID=xxxxxxxx

MAIL_SENDER_UPN=sender@domain.com
REPLY_TO=reply@domain.com

DEV_EMAIL_KEY=long-random-string
DEV_EMAIL_TEST_TO=your@email.com


⸻

7) Run Locally and Send Test Email

Start the worker:

wrangler dev

Send a test email:

curl -i -X POST "http://127.0.0.1:8787/dev/email" \
  -H "content-type: application/json" \
  -H "x-dev-email-key: YOUR_DEV_EMAIL_KEY" \
  -d '{
    "to": "your@email.com",
    "subject": "Graph app-only test",
    "text": "Hello from Cloudflare Worker dev route."
  }'

Expected:
	•	HTTP 200
	•	JSON response with status “ok”
	•	Email arrives

If 401 Unauthorized:
	•	Header missing or incorrect
	•	DEV_EMAIL_KEY not loaded

If Graph errors:
	•	Admin consent missing
	•	Mail.Send not added as Application permission
	•	Sender UPN invalid or mailbox missing

⸻

8) Ensure Node Tests Load .dev.vars

In package.json:

{
  "scripts": {
    "test": "node --env-file=.dev.vars --test --test-concurrency=1"
  }
}

This loads environment variables for local test execution without committing secrets.

⸻

9) Security Notes
	•	Keep .dev.vars in .gitignore.
	•	Protect /dev/email with x-dev-email-key header.
	•	Rotate client secrets periodically.
	•	Consider restricting mailbox access using Exchange Application Access Policies.

⸻

10) Variable Reference

Purpose	Env Variable
Tenant ID	MS_TENANT_ID
Client ID	MS_CLIENT_ID
Client Secret	MS_CLIENT_SECRET_VALUE
Sender UPN	MAIL_SENDER_UPN
Reply-To	REPLY_TO
Dev Route Key	DEV_EMAIL_KEY
Dev Test Recipient	DEV_EMAIL_TEST_TO