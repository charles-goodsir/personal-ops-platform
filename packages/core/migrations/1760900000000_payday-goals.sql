-- Up Migration

-- My payday settings: one row, and a null means "not set yet". The pay, the
-- amounts that come out of it, and the spending target are whole-fortnight
-- amounts in dollars. pay_anchor is the date of one payday; the others fall
-- every 14 days from it.
CREATE TABLE payday_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pay numeric(12, 2) CHECK (pay > 0 AND pay <= 1000000),
  rent_bills numeric(12, 2) CHECK (rent_bills > 0 AND rent_bills <= 1000000),
  savings numeric(12, 2) CHECK (savings > 0 AND savings <= 1000000),
  investments numeric(12, 2) CHECK (investments > 0 AND investments <= 1000000),
  spending_target numeric(12, 2) CHECK (spending_target > 0 AND spending_target <= 1000000),
  pay_anchor date CHECK (pay_anchor BETWEEN '2000-01-01' AND '2100-01-01'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Savings goals. "saved" is what I tell the bot, not read from the bank.
-- The name check keeps out control characters, so a name can't forge a line.
CREATE TABLE goals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  target numeric(12, 2) NOT NULL CHECK (target > 0 AND target <= 10000000),
  saved numeric(12, 2) NOT NULL DEFAULT 0 CHECK (saved >= 0 AND saved <= 10000000),
  weight int NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10),
  due date CHECK (due BETWEEN '2000-01-01' AND '2100-01-01'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX goals_name_key ON goals (lower(name));

GRANT SELECT ON payday_settings, goals TO dashboard_ro;

-- Down Migration
REVOKE SELECT ON payday_settings, goals FROM dashboard_ro;
DROP TABLE goals;
DROP TABLE payday_settings;
