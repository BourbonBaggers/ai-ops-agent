# TEM API (Admin)

All `/admin/*` endpoints are protected by Zero Trust Access.

## Debug/Health
- `GET /debug/whereami`
- `GET /health`

## Policy
- `GET /admin/policy`
- `POST /admin/policy`
  - JSON: `{ "title": "...", "body_markdown": "...", "activate": true }`
- `POST /admin/policy/activate/:id`

## Calendar
- `GET /admin/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /admin/calendar`
  - JSON: `{ "date":"YYYY-MM-DD", "category":"...", "title":"...", "notes":"..." }`
- `PUT /admin/calendar/:id`
- `DELETE /admin/calendar/:id`

## Contacts
- `GET /admin/contacts?status=active&limit=200&offset=0`
- `POST /admin/contacts`
- `PUT /admin/contacts/:id`
- `POST /admin/contacts/import`
  - multipart/form-data: `file=@contacts.csv`
- `GET /admin/contacts/export`
  - returns CSV with HubSpot-friendly headers

## Jobs (Scheduled)
- `POST /jobs/generate-weekly` (Friday 09:00)
- `POST /jobs/lock-weekly` (Tuesday 09:45)
- `POST /jobs/send-weekly` (Tuesday 10:00)

## Tracking (Public)
- `GET /t/open/:token.png`
- `GET /t/click/:token` (302 redirect)
- `GET /t/unsub/:token`