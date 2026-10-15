import { createTestDb, type Db } from "@ops/core";
import { createPaydaySettingsApi } from "@ops/finance";
import { afterAll, beforeAll, expect, test } from "vitest";
import { spendingSection } from "./spending-section.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
// 07:00 NZDT on 15 October, day 2 of the fortnight that began on payday 13 Oct.
const build = () =>
  spendingSection(getDb(), () => new Date("2026-10-14T18:00:00Z")).build();

beforeAll(async () => {
  testDb = await createTestDb("briefing_spending");
  if (!testDb) return;
  const db = getDb();
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  await db.query(
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
     VALUES ('t1', 'acc', '2026-10-14T10:59:00Z', 'COUNTDOWN', -150, 'EFTPOS', 'Groceries', now()),
            ('t2', 'acc', '2026-10-14T10:59:00Z', 'LANDLORD', -370, 'EFTPOS', 'Housing', now()),
            ('t3', 'acc', '2026-10-12T10:59:00Z', 'COUNTDOWN', -500, 'EFTPOS', 'Groceries', now())`,
  );
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

run(
  "says nothing until a payday and target are set, then the fortnight so far without rent and bills, and flags going over",
  async () => {
    expect(await build()).toBeNull();
    const api = createPaydaySettingsApi(getDb());
    await api.setPayday("2026-10-13");
    expect(await build()).toBeNull();
    await api.setAmount("spending", 400);
    expect(await build()).toBe("$150.00 of $400.00 (37%), 12 days to payday");
    await api.setAmount("spending", 150); // exactly 100%
    expect(await build()).toBe(
      "$150.00 of $150.00 (100%), 12 days to payday OVER",
    );
    await api.setAmount("spending", 100);
    expect(await build()).toBe(
      "$150.00 of $100.00 (150%), 12 days to payday OVER",
    );
  },
);

run(
  "with charges pending it leads with settled plus pending as an estimate, then the split, and ignores a stale list",
  async () => {
    const db = getDb();
    await createPaydaySettingsApi(db).setAmount("spending", 400);
    const pend = (amount: number, fetchedAt: string) =>
      db.query(
        `INSERT INTO pending_transactions (date, description, amount, type, fetched_at)
         VALUES ('2026-10-14T20:00:00Z', 'X', $1, 'EFTPOS', $2)`,
        [amount, fetchedAt],
      );
    await pend(-100, "2026-10-14T17:00:00Z");
    expect(await build()).toBe(
      "about $250.00 of $400.00 (62%), 12 days to payday. $150.00 settled, about $100.00 pending (1 charge).",
    );
    await pend(-1, "2026-10-14T17:00:00Z");
    expect(await build()).toBe(
      "about $251.00 of $400.00 (62%), 12 days to payday. $150.00 settled, about $101.00 pending (2 charges).",
    );
    await pend(-200, "2026-10-14T17:00:00Z");
    expect(await build()).toContain("(112%), 12 days to payday OVER.");
    await db.query(
      "UPDATE pending_transactions SET fetched_at = '2026-10-12T00:00:00Z'",
    );
    expect(await build()).toBe("$150.00 of $400.00 (37%), 12 days to payday");
    await db.query("TRUNCATE pending_transactions");
  },
);
