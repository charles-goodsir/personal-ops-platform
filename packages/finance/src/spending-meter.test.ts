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
  await getDb().query("TRUNCATE transactions, accounts, pending_transactions");
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
      pending: null, // no list has been fetched
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
      pending: { spent: 0, count: 0, percent: 0 },
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

const pend = (
  rows: [date: string, amount: number, type: string, category: string | null][],
  fetchedAt: string,
) =>
  Promise.all(
    rows.map(([date, amount, type, category]) =>
      getDb().query(
        `INSERT INTO pending_transactions (date, description, amount, type, category, fetched_at)
         VALUES ($1, 'X', $2, $3, $4, $5)`,
        [date, amount, type, category, fetchedAt],
      ),
    ),
  );

test.skipIf(!process.env.DATABASE_URL)(
  "pending counts debits dated in the fortnight with the settled exclusions, and is shown beside the settled figure, never in it",
  async () => {
    await add([["2026-10-14", -319, "Groceries"]]);
    await pend(
      [
        ["2026-10-14T11:30:00Z", -100, "EFTPOS", null], // 15 Oct 00:30 NZ: counted
        ["2026-10-14T10:30:00Z", -20, "EFTPOS", "Groceries"], // 14 Oct 23:30 NZ: counted
        ["2026-10-13T11:30:00Z", -5, "EFTPOS", null], // 14 Oct 00:30 NZ: first day, counted
        ["2026-10-13T10:30:00Z", -999, "EFTPOS", null], // 13 Oct 23:30 NZ: payday, not this fortnight
        ["2026-10-14T11:30:00Z", 50, "EFTPOS", null], // money in
        ["2026-10-14T11:30:00Z", -300, "TRANSFER", null],
        ["2026-10-14T11:30:00Z", -400, "EFTPOS", "Housing"],
        ["2026-10-14T11:30:00Z", -401, "EFTPOS", "Transfers"],
        ["2026-10-14T11:30:00Z", -402, "EFTPOS", "Investments"],
      ],
      "2026-10-15T01:00:00Z",
    );
    const now = new Date("2026-10-15T02:00:00Z");
    expect(await currentMeter(getDb(), settings(), "2026-10-15", now)).toEqual({
      payday: "2026-10-13",
      spent: 319,
      target: 400,
      percent: 79,
      daysLeft: 12,
      pending: { spent: 125, count: 3, percent: 111 }, // (319 + 125) / 400
    });
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "a pending list older than 26 hours is left out, and one with nothing countable is empty, not missing",
  async () => {
    await pend(
      [["2026-10-14T11:30:00Z", -100, "EFTPOS", null]],
      "2026-10-14T00:00:00Z",
    );
    const now = new Date("2026-10-15T02:00:00Z"); // 26h 0m later is the limit
    expect(
      (await currentMeter(getDb(), settings(), "2026-10-15", now))?.pending,
    ).toEqual({ spent: 100, count: 1, percent: 25 });
    const later = new Date("2026-10-15T02:01:00Z");
    expect(
      (await currentMeter(getDb(), settings(), "2026-10-15", later))?.pending,
    ).toBeNull();
    await getDb().query("TRUNCATE pending_transactions");
    await pend(
      [["2026-10-14T11:30:00Z", 50, "EFTPOS", null]],
      "2026-10-15T01:00:00Z",
    );
    expect(
      (await currentMeter(getDb(), settings(), "2026-10-15", now))?.pending,
    ).toEqual({ spent: 0, count: 0, percent: 0 });
  },
);
