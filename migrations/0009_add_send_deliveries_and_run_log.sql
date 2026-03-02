-- Migration number: 0009  2026-02-27
CREATE TABLE IF NOT EXISTS send_deliveries (
  id TEXT PRIMARY KEY,
  send_id TEXT NOT NULL,
  weekly_run_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  funnel_stage TEXT NOT NULL,
  status TEXT NOT NULL, -- pending | sent | skipped | failed | dry_run (reserved)
  graph_status INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (send_id) REFERENCES sends(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_send_deliveries_send_contact_unique
ON send_deliveries (send_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_send_deliveries_weekly
ON send_deliveries (weekly_run_id);

CREATE TABLE IF NOT EXISTS run_log (
  id TEXT PRIMARY KEY,
  weekly_run_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  contacts_total INTEGER NOT NULL,
  attempted INTEGER NOT NULL,
  sent_success INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  skipped_already_sent INTEGER NOT NULL,
  top_count INTEGER NOT NULL,
  mid_count INTEGER NOT NULL,
  bottom_count INTEGER NOT NULL,
  error_rollup_json TEXT,
  sample_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_log_weekly_run
ON run_log (weekly_run_id, finished_at);
