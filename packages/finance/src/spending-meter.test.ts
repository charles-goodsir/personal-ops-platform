import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { PaydaySettings } from "./payday-settings.js";
import { currentMeter } from "./spending-meter.js";

const settings = (over: Partial<PaydaySettings> = {}): PaydaySettings => ({
  pay: 1000,
  rent: 300,
  savings: 200,
  invest: 50,
  spending: 400,
  payday: "2026-10-13",
  ...over,
});

let testDb: Awaited<ReturnType<typeof createTestDb>> | undefined;
const getDb = (): Db => {
  if (!testDb) throw new Error("test database not ready");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("spending_meter");
});
afterAll(() => testDb?.drop());
beforeEach(async () => {
  if (!testDb) return;
  await getDb().query("TRUNCATE transactions, accounts");
  await getDb().query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
});

const add = async (rows: [string, number, string | null][]) => {
  for (const [i, [date, amount, category]] of rows.entries())
    await getDb().query(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
       VALUES ($1, 'acc', $2::date + time '10:59', 'X', $3, 'EFTPOS', $4, now())`,
      [`t${i}`, date, amount, category],
    );
};

test.skipIf(!process.env.DATABASE_URL)(
  "counts from the day after payday to today, leaves out payday itself, rent and bills, and later days, and rounds the percent down",
  async () => {
    await add([
      ["2026-10-13", -999, "Groceries"], // payday: the last fortnight's
      ["2026-10-14", -100, "Groceries"],
      ["2026-10-15", -219, null], // today
      ["2026-10-14", -370, "Housing"],
      ["2026-10-16", -999, "Groceries"], // after today
    ]);
    expect(await currentMeter(getDb(), settings(), "2026-10-15")).toEqual({
      payday: "2026-10-13",
      spent: 319,
      target: 400,
      percent: 79, // 79.75
      daysLeft: 12,
    });
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "is empty on payday itself and starts again at the next payday",
  async () => {
    await add([["2026-10-27", -50, "Groceries"]]);
    // Payday 27 Oct: the 50 belongs to the fortnight that just ended.
    expect(await currentMeter(getDb(), settings(), "2026-10-27")).toEqual({
      payday: "2026-10-27",
      spent: 0,
      target: 400,
      percent: 0,
      daysLeft: 14,
    });
    expect(await currentMeter(getDb(), settings(), "2026-10-28")).toMatchObject(
      { payday: "2026-10-27", spent: 0, daysLeft: 13 },
    );
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "is null without a payday or a target, or before the first payday",
  async () => {
    const db = getDb();
    expect(
      await currentMeter(db, settings({ payday: null }), "2026-10-15"),
    ).toBe(null);
    expect(
      await currentMeter(db, settings({ spending: null }), "2026-10-15"),
    ).toBe(null);
    expect(await currentMeter(db, settings(), "2026-10-12")).toBe(null);
  },
);
