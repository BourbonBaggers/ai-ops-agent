-- Migration number: 0004 	 2026-02-17T19:40:12.099Z
ALTER TABLE weekly_runs ADD COLUMN updated_at TEXT;
UPDATE weekly_runs SET updated_at = created_at WHERE updated_at IS NULL;