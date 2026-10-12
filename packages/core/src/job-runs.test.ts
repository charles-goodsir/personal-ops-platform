import { afterAll, beforeAll, expect, test } from "vitest";
import type { Db } from "./db.js";
import { vi } from "vitest";
import { listJobRuns, recordRun, trackRun } from "./job-runs.js";
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

const logger = () => ({ error: vi.fn(), warn: vi.fn() });

run("trackRun records a success and returns true", async () => {
  const log = logger();
  expect(await trackRun(getDb(), log, "summary", async () => {})).toBe(true);
  const row = (await listJobRuns(getDb())).find((r) => r.job === "summary");
  expect(row?.lastSuccess).toBeInstanceOf(Date);
  expect(log.error).not.toHaveBeenCalled();
});

run("trackRun records a failure, logs it, and does not throw", async () => {
  const log = logger();
  const ok = await trackRun(getDb(), log, "knowledge-base-scan", async () => {
    throw new Error("ollama down");
  });
  expect(ok).toBe(false);
  expect(log.error).toHaveBeenCalledOnce();
  const row = (await listJobRuns(getDb())).find(
    (r) => r.job === "knowledge-base-scan",
  );
  expect(row).toMatchObject({ consecutiveFailures: 1, lastSuccess: null });
});

test("trackRun keeps the job's result when the heartbeat can't be written", async () => {
  const log = logger();
  const brokenDb = {
    query: async () => {
      throw new Error("database is down");
    },
  } as unknown as Db;
  expect(await trackRun(brokenDb, log, "briefing", async () => {})).toBe(true);
  expect(
    await trackRun(brokenDb, log, "briefing", async () => {
      throw new Error("send failed");
    }),
  ).toBe(false);
  expect(log.warn).toHaveBeenCalledTimes(2);
});
