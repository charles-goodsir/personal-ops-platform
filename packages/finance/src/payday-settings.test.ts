import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPaydaySettingsApi, validDate } from "./payday-settings.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("payday_settings");
});
afterAll(() => testDb?.drop());
beforeEach(async () => {
  if (testDb) await getDb().query("TRUNCATE payday_settings");
});

const live = () => (testDb ? createPaydaySettingsApi(getDb()) : undefined);
const needsDb = test.skipIf(!process.env.DATABASE_URL);

needsDb(
  "nothing is set at first, and each item is set and replaced on its own",
  async () => {
    const api = live();
    expect(await api?.getSettings()).toEqual({
      pay: null,
      rent: null,
      savings: null,
      invest: null,
      spending: null,
      payday: null,
    });
    await api?.setAmount("pay", 1000.5);
    await api?.setAmount("rent", 300);
    await api?.setAmount("savings", 200.456);
    await api?.setAmount("invest", 50);
    await api?.setAmount("spending", 250);
    await api?.setPayday("2026-10-13");
    expect(await api?.getSettings()).toEqual({
      pay: 1000.5,
      rent: 300,
      savings: 200.46, // rounded to cents
      invest: 50,
      spending: 250,
      payday: "2026-10-13",
    });
    await api?.setAmount("spending", 240);
    expect((await api?.getSettings())?.spending).toBe(240);
    expect((await api?.getSettings())?.pay).toBe(1000.5);
    const { rows } = await getDb().query(
      "SELECT count(*)::int AS n FROM payday_settings",
    );
    expect(rows[0]?.n).toBe(1);
  },
);

needsDb(
  "bad amounts and unknown items are refused and write nothing",
  async () => {
    const api = live();
    for (const bad of [0, -5, 1e9, 1_000_000.01, NaN, Infinity, -Infinity])
      await expect(api?.setAmount("pay", bad), String(bad)).rejects.toThrow(
        /amount/,
      );
    await expect(
      api?.setAmount("pay); DROP TABLE goals; --" as "pay", 100),
    ).rejects.toThrow(/unknown item/);
    await expect(api?.setAmount("constructor" as "pay", 100)).rejects.toThrow(
      /unknown item/,
    );
    expect((await api?.getSettings())?.pay).toBeNull();
  },
);

needsDb("dates must be real calendar dates", async () => {
  const api = live();
  for (const bad of [
    "tomorrow",
    "2026-02-30",
    "2026-13-01",
    "26-10-13",
    "2026-10-13T00:00",
    "1999-12-31",
    "2100-01-01",
    "",
  ])
    await expect(api?.setPayday(bad), bad).rejects.toThrow(/date/);
  expect((await api?.getSettings())?.payday).toBeNull();
  expect(validDate("2026-10-13")).toBe("2026-10-13");
});

needsDb(
  "the table refuses what the code refuses, and keeps one row",
  async () => {
    const db = getDb();
    await expect(
      db.query("INSERT INTO payday_settings (id, pay) VALUES (true, -1)"),
    ).rejects.toThrow(/check/i);
    await expect(
      db.query("INSERT INTO payday_settings (id, pay) VALUES (true, 2000000)"),
    ).rejects.toThrow(/check/i);
    await db.query("INSERT INTO payday_settings (id, pay) VALUES (true, 10)");
    await expect(
      db.query("INSERT INTO payday_settings (id, pay) VALUES (false, 10)"),
    ).rejects.toThrow(/check/i);
  },
);
