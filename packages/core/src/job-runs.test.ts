import { afterAll, beforeAll, expect, test } from "vitest";
import type { Db } from "./db.js";
import { vi } from "vitest";
import {
  clearAlert,
  jobHealth,
  listJobRuns,
  markAlerted,
  MAX_QUIET_MS,
  recordRun,
  trackRun,
  type JobRun,
} from "./job-runs.js";
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

const at = new Date("2026-10-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(at.getTime() - h * 3_600_000);
const row = (over: Partial<JobRun>): JobRun => ({
  job: "finance-sync",
  lastSuccess: null,
  lastFailure: null,
  consecutiveFailures: 0,
  alertedAt: null,
  ...over,
});

test("jobHealth: ok inside the window, late just past it", () => {
  const limit = MAX_QUIET_MS["finance-sync"] / 3_600_000;
  expect(
    jobHealth("finance-sync", row({ lastSuccess: hoursAgo(limit - 0.1) }), at)
      .state,
  ).toBe("ok");
  expect(
    jobHealth("finance-sync", row({ lastSuccess: hoursAgo(limit + 0.1) }), at)
      .state,
  ).toBe("late");
});

test("jobHealth: failing inside the window, late once it runs out, never without a success", () => {
  const failing = row({ lastSuccess: hoursAgo(2), consecutiveFailures: 2 });
  expect(jobHealth("finance-sync", failing, at)).toMatchObject({
    state: "failing",
    failures: 2,
  });
  expect(
    jobHealth("finance-sync", { ...failing, lastSuccess: hoursAgo(20) }, at)
      .state,
  ).toBe("late");
  expect(jobHealth("summary", undefined, at)).toEqual({
    state: "never",
    failures: 0,
  });
  expect(
    jobHealth("summary", row({ job: "summary", consecutiveFailures: 4 }), at),
  ).toEqual({ state: "never", failures: 4 });
});

test("each job's quiet limit matches how often it runs", () => {
  const h = (job: keyof typeof MAX_QUIET_MS) => MAX_QUIET_MS[job] / 3_600_000;
  expect(h("knowledge-base-scan")).toBeGreaterThan(0.25); // runs every 15 minutes
  expect(h("finance-sync")).toBeGreaterThan(6); // every 6 hours
  expect(h("backup")).toBeGreaterThan(24); // nightly
  expect(h("briefing")).toBeGreaterThan(24); // daily
  expect(h("summary")).toBeGreaterThan(7 * 24); // weekly
});

run("markAlerted and clearAlert set and clear alerted_at", async () => {
  const db = getDb();
  await recordRun(db, "backup", true, t(1));
  await markAlerted(db, "backup", t(5));
  expect(
    (await listJobRuns(db)).find((r) => r.job === "backup")?.alertedAt,
  ).toEqual(t(5));
  await clearAlert(db, "backup");
  expect(
    (await listJobRuns(db)).find((r) => r.job === "backup")?.alertedAt,
  ).toBeNull();
});
