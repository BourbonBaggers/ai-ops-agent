-- migrations/0012_add_target_send_date_unique_index.sql
-- Enforce that each distinct send date can only have one weekly_run row.
-- NULL rows are excluded (old rows before 0011 migration, or manually created runs).
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_runs_target_send_date_unique
ON weekly_runs (target_send_date)
WHERE target_send_date IS NOT NULL;
