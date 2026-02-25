-- Migration number: 0006  2026-02-25
-- Add order_count to contacts table for rep segmentation.
-- order_count = 0 means rep is cold (no orders placed).
-- order_count > 0 means rep is activated (has placed orders).
-- This value is manually maintained by the operator via PATCH /admin/contacts/:id.
ALTER TABLE contacts ADD COLUMN order_count INTEGER NOT NULL DEFAULT 0;
