-- Migration number: 0010  2026-03-02
ALTER TABLE run_log ADD COLUMN dry_run_count INTEGER NOT NULL DEFAULT 0;
