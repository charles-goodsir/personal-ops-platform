import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { checkBudgetAlerts } from "./budget-alerts.js";
import { createBudgetsApi } from "./budgets.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("budget_alerts");
});
afterAll(() => testDb?.drop());

// 14 October 2026, 13:00 NZDT.
const october = new Date("2026-10-14T00:00:00Z");
const november = new Date("2026-11-10T00:00:00Z");
let n = 0;
const spend = (category: string, amount: number, date = "2026-10-05") =>
  getDb().query(
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
     VALUES ($1, 'acc', $2, 'SHOP', $3, 'EFTPOS', $4, now())`,
    [`t${++n}`, `${date}T00:00:00Z`, -amount, category],
  );
const mockSend = () => vi.fn<(text: string) => Promise<void>>(async () => {});
const needsDb = test.skipIf(!process.env.DATABASE_URL);

beforeEach(async () => {
  if (!testDb) return;
  const db = getDb();
  await db.query("TRUNCATE transactions, accounts, budgets");
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  await createBudgetsApi(db).setBudget("Groceries", 100);
});

needsDb("under 80% sends nothing", async () => {
  await spend("Groceries", 79);
  const send = mockSend();
  expect(await checkBudgetAlerts(getDb(), send, october)).toBe(0);
  expect(send).not.toHaveBeenCalled();
});

needsDb("each level is sent once, then 100% once", async () => {
  const send = mockSend();
  await spend("Groceries", 85);
  expect(await checkBudgetAlerts(getDb(), send, october)).toBe(1);
  expect(send.mock.calls[0]?.[0]).toBe(
    "Budget alert\nGroceries has used 85% of its budget: $85.00 of $100.00\nTransactions up to 2026-10-14.",
  );
  expect(await checkBudgetAlerts(getDb(), send, october)).toBe(0);
  await spend("Groceries", 20);
  expect(await checkBudgetAlerts(getDb(), send, october)).toBe(1);
  expect(send.mock.calls[1]?.[0]).toContain(
    "Groceries is over budget: $105.00 of $100.00 (105%)",
  );
  expect(await checkBudgetAlerts(getDb(), send, october)).toBe(0);
  expect(send).toHaveBeenCalledTimes(2);
});

needsDb("jumping straight past 100% sends one alert, not two", async () => {
  const send = mockSend();
  await spend("Groceries", 150);
  await checkBudgetAlerts(getDb(), send, october);
  await checkBudgetAlerts(getDb(), send, october);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toContain("over budget");
});

needsDb("several budgets crossing together share one message", async () => {
  const send = mockSend();
  await createBudgetsApi(getDb()).setBudget("Eating out", 50);
  await spend("Groceries", 90);
  await spend("Eating out", 60);
  expect(await checkBudgetAlerts(getDb(), send, october)).toBe(2);
  expect(send).toHaveBeenCalledTimes(1);
});

needsDb(
  "a failed send is recorded as not sent, so it is tried again",
  async () => {
    await spend("Groceries", 90);
    const failing = vi.fn(async () => {
      throw new Error("telegram down");
    });
    await expect(
      checkBudgetAlerts(getDb(), failing, october),
    ).rejects.toThrow();
    const send = mockSend();
    expect(await checkBudgetAlerts(getDb(), send, october)).toBe(1);
  },
);

needsDb("a new month starts again", async () => {
  const send = mockSend();
  await spend("Groceries", 90);
  await checkBudgetAlerts(getDb(), send, october);
  await spend("Groceries", 95, "2026-11-03");
  expect(await checkBudgetAlerts(getDb(), send, november)).toBe(1);
  expect(send).toHaveBeenCalledTimes(2);
});

needsDb("changing the limit starts its alerts again", async () => {
  const send = mockSend();
  await spend("Groceries", 90);
  await checkBudgetAlerts(getDb(), send, october);
  await createBudgetsApi(getDb()).setBudget("Groceries", 110);
  expect(await checkBudgetAlerts(getDb(), send, october)).toBe(1);
  expect(send.mock.calls[1]?.[0]).toContain("82%");
});
