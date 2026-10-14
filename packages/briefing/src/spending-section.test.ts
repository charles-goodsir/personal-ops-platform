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
