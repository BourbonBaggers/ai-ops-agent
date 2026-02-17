-- Migration number: 0003 	 2026-02-17T19:21:19.823Z
-- Config key/value store (JSON in value_json)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tracks what the system has done for a given “week”
-- week_key format: YYYY-MM-DD (Monday of that week in America/Chicago)
CREATE TABLE IF NOT EXISTS weekly_runs (
  id TEXT PRIMARY KEY,
  week_key TEXT NOT NULL UNIQUE,
  generate_at TEXT,
  lock_at TEXT,
  send_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);