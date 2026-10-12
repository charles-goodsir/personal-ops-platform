import {
  createTestDb,
  listJobRuns,
  recordRun,
  type Db,
  type Job,
} from "@ops/core";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createWatchdog } from "./watchdog.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("watchdog");
});
afterAll(() => testDb?.drop());
afterEach(async () => {
  await testDb?.db.query("DELETE FROM job_runs");
});

const run = test.skipIf(!process.env.DATABASE_URL);
const now = new Date("2026-10-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const mockSend = () => vi.fn<(text: string) => Promise<void>>(async () => {});
const setup = (send = mockSend()) => ({
  send,
  watchdog: createWatchdog({
    db: getDb(),
    send,
    logger: { warn: vi.fn() },
    now: () => now,
  }),
});
const alerted = async (job: Job) =>
  (await listJobRuns(getDb())).find((r) => r.job === job)?.alertedAt ?? null;

run(
  "a job quiet for too long gets one alert, with its name and age",
  async () => {
    await recordRun(getDb(), "finance-sync", true, hoursAgo(30));
    const { watchdog, send } = setup();
    await watchdog.check();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      "Finance sync has not succeeded for 30h.",
    );
    expect(await alerted("finance-sync")).toEqual(now);
    await watchdog.check();
    await watchdog.check();
    expect(send).toHaveBeenCalledTimes(1); // no repeat while it stays down
  },
);

run(
  "when the job works again it says so once, and clears the alert",
  async () => {
    await recordRun(getDb(), "backup", true, hoursAgo(30));
    const { watchdog, send } = setup();
    await watchdog.check();
    await recordRun(getDb(), "backup", true, hoursAgo(1));
    await watchdog.check();
    await watchdog.check();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      "Backup has not succeeded for 30h.",
      "Backup is working again.",
    ]);
    expect(await alerted("backup")).toBeNull();
  },
);

run(
  "a job that failed but is still inside its window does not alert",
  async () => {
    await recordRun(getDb(), "finance-sync", true, hoursAgo(5));
    await recordRun(getDb(), "finance-sync", false, hoursAgo(1));
    const { watchdog, send } = setup();
    await watchdog.check();
    expect(send).not.toHaveBeenCalled();
  },
);

run("a job that has never reported does not alert", async () => {
  await recordRun(getDb(), "summary", false, hoursAgo(1)); // failed, never succeeded
  const { watchdog, send } = setup();
  await watchdog.check();
  expect(send).not.toHaveBeenCalled();
});

run("each late job gets its own alert", async () => {
  await recordRun(getDb(), "backup", true, hoursAgo(40));
  await recordRun(getDb(), "briefing", true, hoursAgo(50));
  const { watchdog, send } = setup();
  await watchdog.check();
  expect(send.mock.calls.map((c) => c[0]).sort()).toEqual([
    "Backup has not succeeded for 40h.",
    "Daily briefing has not succeeded for 2d.",
  ]);
});

run(
  "if the alert can't be sent nothing is marked, so the next check retries",
  async () => {
    await recordRun(getDb(), "backup", true, hoursAgo(30));
    const send = mockSend().mockRejectedValueOnce(new Error("telegram down"));
    const { watchdog } = setup(send);
    await watchdog.check();
    expect(await alerted("backup")).toBeNull();
    await watchdog.check();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await alerted("backup")).toEqual(now);
  },
);

run("run() checks on an interval and stops when aborted", async () => {
  await recordRun(getDb(), "backup", true, hoursAgo(30));
  const send = mockSend();
  const watchdog = createWatchdog({
    db: getDb(),
    send,
    logger: { warn: vi.fn() },
    now: () => now,
    intervalMs: 20,
  });
  const controller = new AbortController();
  const done = watchdog.run(controller.signal);
  await new Promise((r) => setTimeout(r, 250));
  controller.abort();
  await done;
  expect(send).toHaveBeenCalledTimes(1); // checked many times, alerted once
});

const quickLoop = async (
  db: Db,
  ping: () => Promise<void>,
  warn = vi.fn(),
): Promise<void> => {
  const watchdog = createWatchdog({
    db,
    send: mockSend(),
    logger: { warn },
    ping,
    now: () => now,
    intervalMs: 20,
  });
  const controller = new AbortController();
  const done = watchdog.run(controller.signal);
  await new Promise((r) => setTimeout(r, 250));
  controller.abort();
  await done;
};
const emptyDb = { query: async () => ({ rows: [] }) } as unknown as Db;

test("pings after each check that worked, and a failed ping is only logged", async () => {
  const warn = vi.fn();
  const ping = vi.fn<() => Promise<void>>(async () => {
    throw new Error("no response");
  });
  await quickLoop(emptyDb, ping, warn);
  expect(ping.mock.calls.length).toBeGreaterThan(3); // kept checking after failures
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.any(Error) }),
    "healthcheck ping failed",
  );
});

test("does not ping when the check itself fails", async () => {
  const brokenDb = {
    query: async () => {
      throw new Error("database down");
    },
  } as unknown as Db;
  const ping = vi.fn<() => Promise<void>>(async () => {});
  await quickLoop(brokenDb, ping);
  expect(ping).not.toHaveBeenCalled();
});
