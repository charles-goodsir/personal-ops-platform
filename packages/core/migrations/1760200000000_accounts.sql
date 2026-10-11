-- Up Migration

-- Bank accounts from Akahu. No account numbers or holder names: the brief
-- keeps account numbers out of storage, logs and prompts.
CREATE TABLE accounts (
  akahu_id text PRIMARY KEY, -- acc_...
  name text NOT NULL,
  bank text NOT NULL, -- Akahu connection name, e.g. "ANZ"
  type text NOT NULL, -- CHECKING, SAVINGS, CREDITCARD, ...
  status text NOT NULL, -- ACTIVE or INACTIVE
  currency text NOT NULL,
  balance_current numeric(14, 2),
  balance_available numeric(14, 2),
  transactions_refreshed_at timestamptz, -- when Akahu last pulled from the bank
  synced_at timestamptz NOT NULL
);

-- Down Migration
DROP TABLE accounts;
