import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { formatFreshness } from "./format.js";
import { createFinanceApi } from "./read.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("freshness");
});
afterAll(() => testDb?.drop());

test("formats the time in New Zealand, with how long ago", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  expect(formatFreshness(new Date("2026-10-12T22:17:22Z"), now)).toBe(
    "Bank data refreshed Tue 13 Oct, 11:17 (26h ago)",
  );
  expect(formatFreshness(new Date("2026-10-09T22:17:22Z"), now)).toContain(
    "(4d ago)",
  );
  expect(formatFreshness(null, now)).toBe("Bank data: refresh time unknown");
});

test.skipIf(!process.env.DATABASE_URL)(
  "freshness is the account furthest behind, and inactive accounts are ignored",
  async () => {
    const db = getDb();
    const api = createFinanceApi(db);
    expect(await api.getBankFreshness()).toBeNull();
    for (const [id, status, at] of [
      ["a", "ACTIVE", "2026-10-13T22:17:22Z"],
      ["b", "ACTIVE", "2026-10-14T00:30:00Z"],
      ["old", "INACTIVE", "2026-01-01T00:00:00Z"],
    ])
      await db.query(
        `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, transactions_refreshed_at, synced_at)
         VALUES ($1, $1, 'Westpac', 'CHECKING', $2, 'NZD', $3, now())`,
        [id, status, at],
      );
    expect(await api.getBankFreshness()).toEqual(
      new Date("2026-10-13T22:17:22Z"),
    );
  },
);
