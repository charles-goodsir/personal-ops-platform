import type { Db } from "./db.js";
import type { Logger } from "./logger.js";

// The jobs that report in. The watchdog knows how long each may stay quiet.
export const JOBS = [
  "finance-sync",
  "knowledge-base-scan",
  "briefing",
  "summary",
  "backup",
] as const;
export type Job = (typeof JOBS)[number];

export type JobRun = {
  job: string;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  consecutiveFailures: number;
  alertedAt: Date | null;
};

// A success clears the failure count. The watchdog clears `alerted_at` itself,
// after it has sent the "recovered" message.
export async function recordRun(
  db: Db,
  job: Job,
  ok: boolean,
  at = new Date(),
): Promise<void> {
  if (ok) {
    await db.query(
      `INSERT INTO job_runs (job, last_success) VALUES ($1, $2)
       ON CONFLICT (job) DO UPDATE
       SET last_success = $2, consecutive_failures = 0`,
      [job, at],
    );
  } else {
    await db.query(
      `INSERT INTO job_runs (job, last_failure, consecutive_failures) VALUES ($1, $2, 1)
       ON CONFLICT (job) DO UPDATE
       SET last_failure = $2, consecutive_failures = job_runs.consecutive_failures + 1`,
      [job, at],
    );
  }
}

export async function listJobRuns(db: Db): Promise<JobRun[]> {
  const { rows } = await db.query<JobRun>(
    `SELECT job, last_success AS "lastSuccess", last_failure AS "lastFailure",
            consecutive_failures AS "consecutiveFailures", alerted_at AS "alertedAt"
     FROM job_runs ORDER BY job`,
  );
  return rows;
}

// Runs a job and records how it went. A failure is logged and returned, never
// thrown, so a scheduler loop keeps running. If the heartbeat itself can't be
// written (the database is down, say) that is logged too: it must never break
// the job it reports on.
export async function trackRun(
  db: Db,
  logger: Pick<Logger, "error" | "warn">,
  job: Job,
  fn: () => Promise<unknown>,
): Promise<boolean> {
  let ok = true;
  try {
    await fn();
  } catch (err) {
    ok = false;
    logger.error({ err, job }, "job failed");
  }
  try {
    await recordRun(db, job, ok);
  } catch (err) {
    logger.warn({ err, job }, "could not record the job's heartbeat");
  }
  return ok;
}
