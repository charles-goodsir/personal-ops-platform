import {
  clearAlert,
  JOBS,
  jobHealth,
  listJobRuns,
  markAlerted,
  type Db,
  type Job,
  type Logger,
} from "@ops/core";
import { ago } from "./format.js";

const LABELS: Record<Job, string> = {
  "finance-sync": "Finance sync",
  "knowledge-base-scan": "Notes scan",
  briefing: "Daily briefing",
  summary: "Weekly summary",
  backup: "Backup",
};

const CHECK_MS = 5 * 60 * 1000;

// Reads each job's heartbeat and tells me when one has gone quiet for too long,
// once per incident, then once more when it works again. Messages carry the job
// and the age only: no error text, which could hold a URL or a key. A job that
// has never reported is not alerted on, so a first deploy stays quiet. If the
// bot itself is down nothing alerts here, so after each check that worked it
// pings an outside dead-man's switch, which does the alerting if the pings stop.
// No ping when the check itself fails (the database is down, say), and a failed
// ping is only logged: it must never stop the checks.
export function createWatchdog(opts: {
  db: Db;
  send: (text: string) => Promise<void>;
  logger: Pick<Logger, "warn">;
  ping?: () => Promise<void>;
  now?: () => Date;
  intervalMs?: number;
}) {
  const { db, send, logger } = opts;
  const now = opts.now ?? (() => new Date());

  async function check(): Promise<void> {
    const runs = await listJobRuns(db);
    for (const job of JOBS) {
      try {
        const run = runs.find((r) => r.job === job);
        const health = jobHealth(job, run, now());
        if (health.state === "late" && !run?.alertedAt) {
          // Send first: if it fails, nothing is marked and the next check retries.
          await send(
            `${LABELS[job]} has not succeeded for ${ago(health.ageMs)}.`,
          );
          await markAlerted(db, job, now());
        } else if (health.state !== "late" && run?.alertedAt) {
          await send(`${LABELS[job]} is working again.`);
          await clearAlert(db, job);
        }
      } catch (err) {
        logger.warn({ err, job }, "watchdog could not alert about a job");
      }
    }
  }

  async function run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await check();
        await opts.ping?.().catch((err: unknown) => {
          logger.warn({ err }, "healthcheck ping failed");
        });
      } catch (err) {
        logger.warn({ err }, "watchdog check failed");
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, opts.intervalMs ?? CHECK_MS);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }

  return { check, run };
}
