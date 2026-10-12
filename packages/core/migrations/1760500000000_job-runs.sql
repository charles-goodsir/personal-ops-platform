-- Up Migration

-- One row per background job: when it last worked and when it last failed, so
-- /status can show it and the watchdog can notice when one goes quiet. No error
-- text is stored, because an error message can carry a URL or a key.
CREATE TABLE job_runs (
  job text PRIMARY KEY,
  last_success timestamptz,
  last_failure timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0,
  alerted_at timestamptz -- when the watchdog last alerted about this job; null when healthy
);

-- Down Migration
DROP TABLE job_runs;
