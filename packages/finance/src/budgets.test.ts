import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createBudgetsApi } from "./budgets.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("budgets");
});
afterAll(() => testDb?.drop());

const range = {
  from: new Date("2026-10-01T00:00:00Z"),
  to: new Date("2026-11-01T00:00:00Z"),
  label: "October",
};

beforeEach(async () => {
  if (!testDb) return;
  const db = getDb();
  await db.query("TRUNCATE transactions, accounts, budgets");
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  await db.query(
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
     VALUES ('t1', 'acc', '2026-10-05T00:00:00Z', 'COUNTDOWN', -150, 'EFTPOS', 'Groceries', now()),
            ('t2', 'acc', '2026-10-09T00:00:00Z', 'PAK N SAVE', -100.5, 'EFTPOS', 'Groceries', now()),
            ('t3', 'acc', '2026-10-10T00:00:00Z', 'CAFE', -20, 'EFTPOS', 'Eating out', now()),
            ('t4', 'acc', '2026-09-20T00:00:00Z', 'COUNTDOWN', -400, 'EFTPOS', 'Groceries', now())`,
  );
});

const live = () => (testDb ? createBudgetsApi(getDb()) : undefined);
const needsDb = test.skipIf(!process.env.DATABASE_URL);

needsDb("sets, replaces, lists and removes a budget", async () => {
  const api = live();
  expect(await api?.setBudget("Groceries", 300)).toEqual({
    category: "Groceries",
    limit: 300,
    replaced: null,
  });
  expect(await api?.setBudget("Groceries", 250.456)).toEqual({
    category: "Groceries",
    limit: 250.46,
    replaced: 300,
  });
  expect(await api?.listBudgets()).toEqual([
    { category: "Groceries", limit: 250.46 },
  ]);
  expect(await api?.removeBudget("Groceries")).toEqual({
    category: "Groceries",
    removed: true,
  });
  expect(await api?.removeBudget("Groceries")).toMatchObject({
    removed: false,
  });
});

needsDb("status counts only spending inside the range", async () => {
  const api = live();
  await api?.setBudget("Groceries", 250);
  await api?.setBudget("Eating out", 10);
  await api?.setBudget("Travel", 500);
  expect(await api?.budgetStatus(range)).toEqual([
    { category: "Eating out", limit: 10, spent: 20, percent: 200 },
    { category: "Groceries", limit: 250, spent: 250.5, percent: 100 },
    { category: "Travel", limit: 500, spent: 0, percent: 0 },
  ]);
});

needsDb("refuses bad amounts and categories without writing", async () => {
  const api = live();
  for (const bad of [0, -5, 1e9, NaN, Infinity])
    await expect(api?.setBudget("Groceries", bad)).rejects.toThrow(/amount/);
  for (const bad of ["Income", "Transfers", "Investments", "Nope"])
    await expect(api?.setBudget(bad as "Groceries", 100)).rejects.toThrow(
      /budget/,
    );
  expect(await api?.listBudgets()).toEqual([]);
});

needsDb("the table itself refuses a limit the code would refuse", async () => {
  await expect(
    getDb().query(
      "INSERT INTO budgets (category, monthly_limit) VALUES ('Groceries', -1)",
    ),
  ).rejects.toThrow(/check/i);
});
