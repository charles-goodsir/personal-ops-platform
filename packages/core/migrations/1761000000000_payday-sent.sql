-- Up Migration

-- The payday the message was last sent for, so a restart or a second sync never
-- sends it twice.
ALTER TABLE payday_settings
  ADD COLUMN last_payday_sent date CHECK (last_payday_sent BETWEEN '2000-01-01' AND '2100-01-01');

-- Down Migration
ALTER TABLE payday_settings DROP COLUMN last_payday_sent;
