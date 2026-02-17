-- Migration number: 0001 	 2026-02-17T15:11:42.668Z
-- Contacts (HubSpot-ish)
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  contact_group TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Marketing standards policy (versioned)
CREATE TABLE IF NOT EXISTS policy_versions (
  id TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Calendar items (next 90 days-ish)
CREATE TABLE IF NOT EXISTS calendar_items (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL, -- ISO YYYY-MM-DD
  category TEXT NOT NULL, -- holiday, tradeshow, launch, stock
  title TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Weekly runs (one per scheduled week)
CREATE TABLE IF NOT EXISTS weekly_runs (
  id TEXT PRIMARY KEY,
  week_of TEXT NOT NULL, -- ISO date for Tuesday of that week
  generated_at TEXT,
  locked_at TEXT,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, generated, locked, sent, failed
  focus_notes TEXT,
  selected_candidate_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Candidate emails (3 per weekly run)
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  weekly_run_id TEXT NOT NULL,
  rank INTEGER NOT NULL, -- 1,2,3
  subject TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  cta TEXT,
  image_refs_json TEXT, -- JSON string
  self_check_json TEXT, -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (weekly_run_id) REFERENCES weekly_runs(id)
);

-- Sends (one per weekly run)
CREATE TABLE IF NOT EXISTS sends (
  id TEXT PRIMARY KEY,
  weekly_run_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  sender_mailbox TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  tracking_salt TEXT NOT NULL, -- used for token derivation
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (weekly_run_id) REFERENCES weekly_runs(id),
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

-- Per-recipient send results
CREATE TABLE IF NOT EXISTS send_recipients (
  id TEXT PRIMARY KEY,
  send_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued, sent, bounced, failed, unsubscribed
  provider_message_id TEXT,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (send_id) REFERENCES sends(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

-- Tracking / events
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  send_id TEXT NOT NULL,
  contact_id TEXT,
  type TEXT NOT NULL, -- open, click, unsub, bounce
  url TEXT, -- for click
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (send_id) REFERENCES sends(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_items(date);
CREATE INDEX IF NOT EXISTS idx_candidates_weekly ON candidates(weekly_run_id, rank);
CREATE INDEX IF NOT EXISTS idx_sendrec_send ON send_recipients(send_id);
CREATE INDEX IF NOT EXISTS idx_events_send_type ON events(send_id, type);