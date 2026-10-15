import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createPaydaySettingsApi } from "./payday-settings.js";
import { checkSpendingAlert } from "./spending-alert.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("spending_alert");
});
afterAll(() => testDb?.drop());

// Payday 13 Oct, target 400. 15 Oct 14:00 NZDT is day 2 of the fortnight; 28 Oct
// is day 1 of the next one.
const oct15 = new Date("2026-10-15T01:00:00Z");
const oct28 = new Date("2026-10-28T01:00:00Z");
let n = 0;
const spend = (amount: number, date: string) =>
  getDb().query(
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
     VALUES ($1, 'acc', $2, 'SHOP', $3, 'EFTPOS', 'Groceries', now())`,
    [`t${++n}`, `${date}T00:00:00Z`, -amount],
  );
const mockSend = () => vi.fn<(text: string) => Promise<void>>(async () => {});
const check = async (send: ReturnType<typeof mockSend>, now = oct15) => {
  const api = createPaydaySettingsApi(getDb());
  return checkSpendingAlert(getDb(), await api.getSettings(), send, now);
};
const needsDb = test.skipIf(!process.env.DATABASE_URL);

beforeEach(async () => {
  if (!testDb) return;
  const db = getDb();
  await db.query(
    "TRUNCATE transactions, accounts, payday_settings, pending_transactions",
  );
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  const api = createPaydaySettingsApi(db);
  await api.setAmount("spending", 400);
  await api.setPayday("2026-10-13");
});

needsDb("under 80%, or with no target set, sends nothing", async () => {
  await spend(319, "2026-10-14"); // 79.75%
  const send = mockSend();
  expect(await check(send)).toBe(0);
  await getDb().query("UPDATE payday_settings SET spending_target = NULL");
  await spend(500, "2026-10-14");
  expect(await check(send)).toBe(0);
  expect(send).not.toHaveBeenCalled();
});

needsDb(
  "80% is sent once, then 100% once, and falling back repeats nothing",
  async () => {
    const send = mockSend();
    await spend(340, "2026-10-14");
    expect(await check(send)).toBe(80);
    expect(send.mock.calls[0]?.[0]).toBe(
      "Spending alert\nUsed 85% of the spending target this fortnight: $340.00 of $400.00 (85%), 12 days to payday.",
    );
    expect(await check(send)).toBe(0);
    await spend(70, "2026-10-15");
    expect(await check(send)).toBe(100);
    expect(send.mock.calls[1]?.[0]).toContain("Over the spending target");
    await getDb().query("DELETE FROM transactions WHERE amount = -70");
    expect(await check(send)).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  },
);

needsDb(
  "a failed send is tried again, and the next fortnight starts again",
  async () => {
    await spend(340, "2026-10-14");
    const failing = vi.fn(async () => {
      throw new Error("telegram down");
    });
    await expect(check(failing)).rejects.toThrow();
    const send = mockSend();
    expect(await check(send)).toBe(80);
    await spend(350, "2026-10-28");
    expect(await check(send, oct28)).toBe(80);
    expect(send).toHaveBeenCalledTimes(2);
  },
);

needsDb("pending charges never trigger an alert, however large", async () => {
  await getDb().query(
    `INSERT INTO pending_transactions (date, description, amount, type, fetched_at)
     VALUES ('2026-10-14T20:00:00Z', 'X', -900, 'EFTPOS', '2026-10-15T00:30:00Z')`,
  );
  const send = mockSend();
  expect(await check(send)).toBe(0);
  expect(send).not.toHaveBeenCalled();
});
