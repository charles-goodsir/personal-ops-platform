import { createTestDb, type Db } from "@ops/core";
import { createBudgetsApi } from "@ops/finance";
import { afterAll, beforeAll, expect, test } from "vitest";
import { budgetsSection } from "./budgets-section.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
// 07:00 NZDT on 15 October.
const build = () =>
  budgetsSection(getDb(), () => new Date("2026-10-14T18:00:00Z")).build();

beforeAll(async () => {
  testDb = await createTestDb("briefing_budgets");
  if (!testDb) return;
  const db = getDb();
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  await db.query(
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
     VALUES ('t1', 'acc', '2026-10-03T10:59:00Z', 'COUNTDOWN', -150, 'EFTPOS', 'Groceries', now()),
            ('t2', 'acc', '2026-10-04T10:59:00Z', 'CAFE', -60, 'EFTPOS', 'Eating out', now()),
            ('t3', 'acc', '2026-09-20T10:59:00Z', 'COUNTDOWN', -500, 'EFTPOS', 'Groceries', now())`,
  );
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

run(
  "says nothing until a budget is set, then lists this month against each",
  async () => {
    expect(await build()).toBeNull();
    const api = createBudgetsApi(getDb());
    await api.setBudget("Groceries", 600);
    await api.setBudget("Eating out", 50);
    expect(await build()).toBe(
      "Budgets this month:\n  Eating out: $60.00 of $50.00 (120%) OVER\n  Groceries: $150.00 of $600.00 (25%)",
    );
  },
);
