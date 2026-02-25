-- Migration number: 0007  2026-02-25
-- Add per-candidate template component fields and funnel_stage.
-- funnel_stage is needed for segmentation at send time (top/mid/bottom).
-- body_html is the email-safe HTML fragment injected into {{BODY_HTML}}.
-- action_line, quote_text, rally_line are injected into the template ACTION section.
-- image_url is the allowlisted image URL chosen by the LLM (nullable).
ALTER TABLE candidates ADD COLUMN funnel_stage TEXT;
ALTER TABLE candidates ADD COLUMN body_html TEXT;
ALTER TABLE candidates ADD COLUMN image_url TEXT;
ALTER TABLE candidates ADD COLUMN action_line TEXT;
ALTER TABLE candidates ADD COLUMN quote_text TEXT;
ALTER TABLE candidates ADD COLUMN rally_line TEXT;
