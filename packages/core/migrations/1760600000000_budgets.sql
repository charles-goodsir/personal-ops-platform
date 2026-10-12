-- Up Migration

-- A monthly spending limit per category, set from the bot. One row per category.
CREATE TABLE budgets (
  category text PRIMARY KEY,
  monthly_limit numeric(12, 2) NOT NULL CHECK (monthly_limit > 0 AND monthly_limit <= 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE budgets;
