import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { dateRange } from "./periods.js";
import { createFinanceApi } from "./read.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
const api = () => createFinanceApi(getDb());
const sept = dateRange("2026-09-01", "2026-09-30");

beforeAll(async () => {
  testDb = await createTestDb("read");
  if (!testDb) return;
  const db = getDb();
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  // Stamped like Akahu: 23:59 NZST (+12) = 11:59Z on the date.
  const rows: [string, string, number, string | null, string | null][] = [
    ["2026-08-31", "COUNTDOWN AUG", -99, "Groceries", "Countdown"],
    [
      "2026-09-01",
      "COUNTDOWN PONSONBY 4835123456",
      -50,
      "Groceries",
      "Countdown",
    ],
    ["2026-09-10", "PAK N SAVE", -30.5, "Groceries", null],
    ["2026-09-12", "CAFE 100%_REAL", -12, "Eating out", null],
    ["2026-09-15", "TO SAVINGS", -500, "Transfers", null],
    ["2026-09-16", "SHARESIES", -200, "Investments", null],
    ["2026-09-20", "SALARY", 3000, "Income", null],
    ["2026-09-25", "MYSTERY", -7, null, null],
    ["2026-09-30", "COUNTDOWN", -20, "Groceries", "Countdown"],
    ["2026-10-01", "COUNTDOWN OCT", -88, "Groceries", "Countdown"],
  ];
  for (const [
    i,
    [date, description, amount, category, merchant],
  ] of rows.entries()) {
    await db.query(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, merchant, synced_at)
       VALUES ($1, 'acc', $2::date + time '11:59', $3, $4, 'EFTPOS', $5, $6, now())`,
      [`t${i}`, date, description, amount, category, merchant],
    );
  }
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

run(
  "spending leaves out transfers and investments, and reports them apart",
  async () => {
    expect(await api().getSpending(sept)).toMatchObject({
      total: 119.5,
      income: 3000,
      invested: 200,
      uncategorised: 7,
      byCategory: [
        { category: "Groceries", spent: 100.5, count: 3 },
        { category: "Eating out", spent: 12, count: 1 },
      ],
    });
  },
);

run("one category: total and top payees, digits masked", async () => {
  expect(await api().getCategorySpending(sept, "Groceries")).toMatchObject({
    spent: 100.5,
    count: 3,
    topPayees: [
      { payee: "Countdown", spent: 70, count: 2 },
      { payee: "PAK N SAVE", spent: 30.5, count: 1 },
    ],
  });
});

run("transactions: filters combine, newest first, digits masked", async () => {
  const rows = await api().getTransactions({
    range: sept,
    search: "countdown",
    limit: 10,
  });
  expect(rows.map((r) => r.description)).toEqual([
    "COUNTDOWN",
    "COUNTDOWN PONSONBY [number]",
  ]);
  expect(rows[0]).toMatchObject({
    amount: -20,
    category: "Groceries",
    account: "Everyday",
  });

  const big = await api().getTransactions({
    minAmount: 100,
    maxAmount: 600,
    limit: 10,
  });
  expect(big.map((r) => r.amount)).toEqual([-200, -500]);
  expect(
    await api().getTransactions({ category: "Eating out", limit: 10 }),
  ).toHaveLength(1);
  expect(await api().getTransactions({ limit: 2 })).toHaveLength(2);
});

run("search treats % and _ as plain text", async () => {
  expect(
    await api().getTransactions({ search: "100%_", limit: 10 }),
  ).toHaveLength(1);
  expect(await api().getTransactions({ search: "%", limit: 10 })).toHaveLength(
    1,
  );
  expect(await api().getTransactions({ search: "_", limit: 10 })).toHaveLength(
    1,
  );
});
