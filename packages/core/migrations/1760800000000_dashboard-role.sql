-- Up Migration

-- The dashboard connects as me and switches to this role (SET ROLE), so it can
-- read what the page shows and nothing else. A role is shared by the whole
-- cluster, so the create is skipped when it already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashboard_ro') THEN
    CREATE ROLE dashboard_ro NOLOGIN;
  END IF;
END $$;

GRANT SELECT ON transactions, accounts, budgets, job_runs TO dashboard_ro;

-- Down Migration
REVOKE SELECT ON transactions, accounts, budgets, job_runs FROM dashboard_ro;
