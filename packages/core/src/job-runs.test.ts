import { afterAll, beforeAll, expect, test } from "vitest";
import type { Db } from "./db.js";
import { listJobRuns, recordRun } from "./job-runs.js";
import { createTestDb } from "./test-db.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("job_runs");
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);
const t = (hours: number) => new Date(Date.UTC(2026, 9, 12, hours));

run("a first success creates the row with no failures", async () => {
  await recordRun(getDb(), "backup", true, t(3));
  expect(await listJobRuns(getDb())).toEqual([
    {
      job: "backup",
      lastSuccess: t(3),
      lastFailure: null,
      consecutiveFailures: 0,
      alertedAt: null,
    },
  ]);
});

run(
  "failures count up, and one success clears the count but keeps the last failure",
  async () => {
    const db = getDb();
    await recordRun(db, "finance-sync", false, t(1));
    await recordRun(db, "finance-sync", false, t(2));
    await recordRun(db, "finance-sync", false, t(3));
    const failing = (await listJobRuns(db)).find(
      (r) => r.job === "finance-sync",
    );
    expect(failing).toMatchObject({
      consecutiveFailures: 3,
      lastFailure: t(3),
      lastSuccess: null,
    });
    await recordRun(db, "finance-sync", true, t(4));
    const healed = (await listJobRuns(db)).find(
      (r) => r.job === "finance-sync",
    );
    expect(healed).toMatchObject({
      consecutiveFailures: 0,
      lastSuccess: t(4),
      lastFailure: t(3),
    });
  },
);

run(
  "a success leaves the watchdog's alerted_at alone for it to clear",
  async () => {
    const db = getDb();
    await recordRun(db, "briefing", false, t(1));
    await db.query(
      "UPDATE job_runs SET alerted_at = $1 WHERE job = 'briefing'",
      [t(2)],
    );
    await recordRun(db, "briefing", true, t(3));
    expect(
      (await listJobRuns(db)).find((r) => r.job === "briefing")?.alertedAt,
    ).toEqual(t(2));
  },
);

run("each job has its own row", async () => {
  expect((await listJobRuns(getDb())).map((r) => r.job)).toEqual([
    "backup",
    "briefing",
    "finance-sync",
  ]);
});
