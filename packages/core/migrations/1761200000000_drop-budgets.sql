-- Up Migration

-- Budgets are replaced by the spending meter and savings goals (ADR 12). The
-- limits I set go with the table, and so does the dashboard role's grant on it.
REVOKE SELECT ON budgets FROM dashboard_ro;
DROP TABLE budgets;

-- Down Migration
CREATE TABLE budgets (
  category text PRIMARY KEY,
  monthly_limit numeric(12, 2) NOT NULL CHECK (monthly_limit > 0 AND monthly_limit <= 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  alert_month text,
  alert_level int NOT NULL DEFAULT 0 CHECK (alert_level IN (0, 80, 100))
);
GRANT SELECT ON budgets TO dashboard_ro;
