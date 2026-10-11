-- Up Migration

-- Settled transactions from Akahu, keyed by Akahu's id. No account numbers:
-- meta.other_account and meta.card_suffix are never stored.
CREATE TABLE transactions (
  akahu_id text PRIMARY KEY, -- trans_...
  account_id text NOT NULL REFERENCES accounts (akahu_id),
  date timestamptz NOT NULL,
  description text NOT NULL,
  amount numeric(14, 2) NOT NULL, -- negative = money out
  type text NOT NULL, -- EFTPOS, DIRECT DEBIT, TRANSFER, ...
  merchant text, -- Akahu enrichment, when present
  akahu_category text, -- e.g. "Supermarkets and grocery stores"
  akahu_group text, -- Akahu's personal finance group, e.g. "Food"
  synced_at timestamptz NOT NULL
);

CREATE INDEX transactions_date_idx ON transactions (date);

-- Down Migration
DROP TABLE transactions;
