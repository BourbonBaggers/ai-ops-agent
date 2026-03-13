-- migrations/0011_add_target_send_date.sql
-- Add an explicit send-date anchor so that cross-week scheduling
-- (generate on Friday, send the following Tuesday) is unambiguous.
-- All new weekly_run rows will have this populated by tick().
-- Existing rows will have NULL (harmless; they will be sent or already sent).
ALTER TABLE weekly_runs ADD COLUMN target_send_date TEXT;
