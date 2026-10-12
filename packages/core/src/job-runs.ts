import type { Db } from "./db.js";
import type { Logger } from "./logger.js";

// The jobs that report in. The watchdog knows how long each may stay quiet.
export const JOBS = [
  "finance-sync",
  "knowledge-base-scan",
  "briefing",
  "summary",
  "diary",
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

const HOUR = 3_600_000;

// How long each job may go without a success before something is wrong. The
// notes scan runs every 15 minutes, the
// finance sync, backup, briefing and diary message daily, the summary weekly. Each has slack for one
// missed run.
export const MAX_QUIET_MS: Record<Job, number> = {
  "finance-sync": 26 * HOUR,
  "knowledge-base-scan": 1 * HOUR,
  briefing: 26 * HOUR,
  summary: 8 * 24 * HOUR,
  diary: 26 * HOUR,
  backup: 26 * HOUR,
};

export type JobHealth =
  | { state: "never"; failures: number } // no success recorded yet
  | { state: "ok"; ageMs: number }
  | { state: "failing"; ageMs: number; failures: number } // failed since, still inside its window
  | { state: "late"; ageMs: number }; // quiet for too long: this is what alerts

// A job that has never succeeded is not "late": the weekly summary, for one,
// has nothing to report until its first Monday.
export function jobHealth(
  job: Job,
  run: JobRun | undefined,
  now: Date,
): JobHealth {
  if (!run?.lastSuccess)
    return { state: "never", failures: run?.consecutiveFailures ?? 0 };
  const ageMs = now.getTime() - run.lastSuccess.getTime();
  if (ageMs > MAX_QUIET_MS[job]) return { state: "late", ageMs };
  if (run.consecutiveFailures > 0)
    return { state: "failing", ageMs, failures: run.consecutiveFailures };
  return { state: "ok", ageMs };
}

// The watchdog sets this when it alerts, and clears it when it announces the
// recovery, so each incident produces one alert and one all-clear.
export async function markAlerted(
  db: Db,
  job: Job,
  at = new Date(),
): Promise<void> {
  await db.query("UPDATE job_runs SET alerted_at = $2 WHERE job = $1", [
    job,
    at,
  ]);
}

export async function clearAlert(db: Db, job: Job): Promise<void> {
  await db.query("UPDATE job_runs SET alerted_at = NULL WHERE job = $1", [job]);
}
