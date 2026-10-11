import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createFinanceApi } from "./read.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
const now = new Date("2026-10-12T00:00:00Z");

beforeAll(async () => {
  testDb = await createTestDb("subscriptions");
  if (!testDb) return;
  const db = getDb();
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  const rows: [string, string, number, string | null][] = [
    ...["2026-06-07", "2026-07-07", "2026-08-07", "2026-09-07"].map(
      (d): [string, string, number, string | null] => [
        d,
        "NETFLIX.COM",
        -19.99,
        "Netflix",
      ],
    ),
    // A gym that stopped billing months ago.
    ...["2025-12-01", "2026-01-01", "2026-02-01"].map(
      (d): [string, string, number, string | null] => [d, "GYM", -40, null],
    ),
  ];
  for (const [i, [date, description, amount, merchant]] of rows.entries()) {
    await db.query(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, merchant, synced_at)
       VALUES ($1, 'acc', $2::date + time '11:59', $3, $4, 'DIRECT DEBIT', $5, now())`,
      [`t${i}`, date, description, amount, merchant],
    );
  }
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

run("subscriptions: lapsed ones are hidden unless asked for", async () => {
  const api = createFinanceApi(getDb());
  expect((await api.listSubscriptions(false, now)).map((r) => r.payee)).toEqual(
    ["Netflix"],
  );
  const all = await api.listSubscriptions(true, now);
  expect(all.map((r) => [r.payee, r.active])).toEqual([
    ["gym", false],
    ["Netflix", true],
  ]);
});
