-- Up Migration

-- The highest alert already sent for a budget, and for which month ("2026-10"),
-- so a restart or a second sync never repeats a message.
ALTER TABLE budgets
  ADD COLUMN alert_month text,
  ADD COLUMN alert_level int NOT NULL DEFAULT 0 CHECK (alert_level IN (0, 80, 100));

-- Down Migration
ALTER TABLE budgets
  DROP COLUMN alert_level,
  DROP COLUMN alert_month;
