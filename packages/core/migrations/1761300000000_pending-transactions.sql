-- Up Migration

-- Charges that have not settled yet, as Akahu last listed them. Akahu gives
-- them no id and says they change, so the whole table is replaced on every
-- sync and nothing is matched against the settled transactions. The
-- description is masked before it is stored and is only used to apply my
-- rules; it is never shown or sent anywhere, and the dashboard role cannot
-- read it.
CREATE TABLE pending_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date timestamptz NOT NULL,
  description text NOT NULL CHECK (length(description) <= 300),
  amount numeric(14, 2) NOT NULL CHECK (amount BETWEEN -1000000000 AND 1000000000),
  type text NOT NULL CHECK (length(type) <= 40),
  category text,
  fetched_at timestamptz NOT NULL
);

GRANT SELECT (date, amount, type, category, fetched_at) ON pending_transactions TO dashboard_ro;

-- Down Migration
DROP TABLE pending_transactions;
