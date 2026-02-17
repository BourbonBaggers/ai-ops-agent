-- Dev seed data only. Never run this in production by accident.

-- Example contacts
INSERT INTO contacts (id, firstname, lastname, email, status, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000001','Test','One','test.one@example.com','active',datetime('now'),datetime('now')),
  ('00000000-0000-0000-0000-000000000002','Test','Two','test.two@example.com','active',datetime('now'),datetime('now'));

-- Example policy
INSERT INTO policy_versions (id, is_active, title, body_markdown, created_at)
VALUES ('00000000-0000-0000-0000-000000000010', 1, 'Dev Policy', 'No emojis. No em dashes. No pricing.', datetime('now'));

-- Example calendar item
INSERT INTO calendar_items (id, date, category, title, notes, created_at)
VALUES ('00000000-0000-0000-0000-000000000020', date('now','+7 day'), 'holiday', 'Example Holiday', 'Dev seed item.', datetime('now'));