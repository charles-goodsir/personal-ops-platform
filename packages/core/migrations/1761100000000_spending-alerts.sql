-- Up Migration

-- The highest spending alert already sent, and for which fortnight (the payday
-- it started on), so a restart or a second sync never repeats a message.
ALTER TABLE payday_settings
  ADD COLUMN alert_payday date CHECK (alert_payday BETWEEN '2000-01-01' AND '2100-01-01'),
  ADD COLUMN alert_level int NOT NULL DEFAULT 0 CHECK (alert_level IN (0, 80, 100));

-- Down Migration
ALTER TABLE payday_settings
  DROP COLUMN alert_level,
  DROP COLUMN alert_payday;
