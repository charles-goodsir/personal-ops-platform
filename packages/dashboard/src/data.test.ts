import { createTestDb, type Db } from "@ops/core";
import { createBudgetsApi } from "@ops/finance";
import { afterAll, beforeAll, expect, test } from "vitest";
import { loadDashboard } from "./data.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
// 07:00 NZDT on 15 October 2026.
const now = new Date("2026-10-14T18:00:00Z");

beforeAll(async () => {
  testDb = await createTestDb("dashboard_data");
  if (!testDb) return;
  const db = getDb();
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  const rows: [string, number, string][] = [
    ["2026-10-03", -150, "Groceries"],
    ["2026-10-04", -60, "Eating out"],
    ["2026-09-20", -400, "Groceries"],
    ["2026-08-10", -250, "Groceries"],
    ["2026-05-15", -90, "Groceries"],
    ["2026-04-15", -999, "Groceries"], // older than the six months shown
  ];
  for (const [i, [date, amount, category]] of rows.entries())
    await db.query(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
       VALUES ($1, 'acc', $2::date + time '10:59', 'SHOP', $3, 'EFTPOS', $4, now())`,
      [`t${i}`, date, amount, category],
    );
  await createBudgetsApi(db).setBudget("Groceries", 300);
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

run("loads the month, budgets, a six month trend and every job", async () => {
  const d = await loadDashboard(getDb(), now);
  expect(d.month.total).toBe(210);
  expect(d.budgets).toEqual([
    { category: "Groceries", limit: 300, spent: 150, percent: 50 },
  ]);
  expect(d.trend).toEqual([
    { label: "May", total: 90, current: false },
    { label: "Jun", total: 0, current: false },
    { label: "Jul", total: 0, current: false },
    { label: "Aug", total: 250, current: false },
    { label: "Sep", total: 400, current: false },
    { label: "Oct", total: 210, current: true },
  ]);
  expect(d.jobs.map((j) => j.job)).toContain("finance-sync");
});
