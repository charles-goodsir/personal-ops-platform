-- Up Migration

-- My rules, which always beat the model. A rule matches when its pattern
-- appears (case-insensitive) in the description or Akahu's merchant name.
CREATE TABLE category_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pattern text NOT NULL UNIQUE CHECK (pattern = lower(pattern) AND length(pattern) BETWEEN 2 AND 100),
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE transactions
  ADD COLUMN category text,
  ADD COLUMN category_source text CHECK (category_source IN ('rule', 'model')),
  ADD COLUMN categorised_at timestamptz;

-- Down Migration
ALTER TABLE transactions
  DROP COLUMN categorised_at,
  DROP COLUMN category_source,
  DROP COLUMN category;
DROP TABLE category_rules;
