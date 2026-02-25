-- Migration number: 0008  2026-02-25
CREATE TABLE IF NOT EXISTS email_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  alt TEXT NOT NULL,
  description TEXT NOT NULL,
  product_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_images_product_name ON email_images(product_name);
