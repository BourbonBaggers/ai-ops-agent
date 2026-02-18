-- Remove duplicate sends (keep newest by created_at)
DELETE FROM sends
WHERE id NOT IN (
  SELECT id FROM (
    SELECT s1.id
    FROM sends s1
    LEFT JOIN sends s2
      ON s1.weekly_run_id = s2.weekly_run_id
     AND s1.candidate_id = s2.candidate_id
     AND (
          s1.created_at < s2.created_at
          OR (s1.created_at = s2.created_at AND s1.id < s2.id)
     )
    WHERE s2.id IS NULL
  )
);

-- Add uniqueness constraint
CREATE UNIQUE INDEX idx_sends_weekly_candidate_unique
ON sends (weekly_run_id, candidate_id);