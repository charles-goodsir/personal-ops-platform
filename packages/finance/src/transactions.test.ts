import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { AkahuTransaction } from "./akahu.js";
import { syncTransactions } from "./transactions.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("transactions");
});
afterAll(() => testDb?.drop());

const now = new Date("2026-10-11T00:00:00Z");
const daysAgo = (d: number) =>
  new Date(now.getTime() - d * 86_400_000).toISOString();

const tx = (
  id: string,
  age: number,
  amount = -10,
  account = "acc_live",
): AkahuTransaction => ({
  _id: id,
  _account: account,
  date: daysAgo(age),
  description: `SHOP ${id}`,
  amount,
  type: "EFTPOS",
});

beforeEach(async () => {
  if (!testDb) return;
  await getDb().query("TRUNCATE transactions, accounts");
  await getDb().query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc_live', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now()),
            ('acc_gone', 'Old', 'Westpac', 'SAVINGS', 'INACTIVE', 'NZD', now())`,
  );
});

const akahuWith = (items: AkahuTransaction[]) => ({
  listTransactions: vi.fn(async () => items),
});
const ids = async () =>
  (
    await getDb().query<{ akahu_id: string }>(
      "SELECT akahu_id FROM transactions ORDER BY 1",
    )
  ).rows.map((r) => r.akahu_id);

test.skipIf(!process.env.DATABASE_URL)(
  "first run backfills, later runs read the window",
  async () => {
    const first = akahuWith([tx("old", 300), tx("recent", 2)]);
    expect(await syncTransactions(getDb(), first, { now })).toMatchObject({
      days: 730,
      added: 2,
    });
    expect(first.listTransactions).toHaveBeenCalledWith(
      new Date(daysAgo(730)),
      now,
    );

    const second = akahuWith([tx("recent", 2)]);
    expect(await syncTransactions(getDb(), second, { now })).toMatchObject({
      days: 14,
      added: 0,
      updated: 0,
      removed: 0,
    });
    expect(second.listTransactions).toHaveBeenCalledWith(
      new Date(daysAgo(14)),
      now,
    );
    // "old" is outside the window, so not seeing it again isn't a deletion.
    expect(await ids()).toEqual(["old", "recent"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)("counts real changes only", async () => {
  await syncTransactions(getDb(), akahuWith([tx("a", 1), tx("b", 1)]), { now });
  const result = await syncTransactions(
    getDb(),
    akahuWith([tx("a", 1, -99), tx("b", 1), tx("c", 1)]),
    { now },
  );
  expect(result).toMatchObject({
    fetched: 3,
    added: 1,
    updated: 1,
    removed: 0,
  });
  const { rows } = await getDb().query(
    "SELECT amount FROM transactions WHERE akahu_id = 'a'",
  );
  expect(rows[0]).toEqual({ amount: "-99.00" });
});

test.skipIf(!process.env.DATABASE_URL)(
  "a re-issued id replaces the old row inside the window",
  async () => {
    await syncTransactions(getDb(), akahuWith([tx("keep", 400), tx("v1", 3)]), {
      now,
    });
    const result = await syncTransactions(getDb(), akahuWith([tx("v2", 3)]), {
      now,
    });
    expect(result).toMatchObject({ added: 1, removed: 1 });
    expect(await ids()).toEqual(["keep", "v2"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "an inactive account's transactions are never deleted",
  async () => {
    await syncTransactions(
      getDb(),
      akahuWith([tx("live", 2), tx("gone", 2, -5, "acc_gone")]),
      { now },
    );
    const result = await syncTransactions(getDb(), akahuWith([tx("live", 2)]), {
      now,
    });
    expect(result.removed).toBe(0);
    expect(await ids()).toEqual(["gone", "live"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "a failing insert rolls back, leaving the table as it was",
  async () => {
    await syncTransactions(getDb(), akahuWith([tx("a", 1)]), { now });
    // Unknown account: the foreign key fails after the upsert has started.
    await expect(
      syncTransactions(
        getDb(),
        akahuWith([tx("b", 1), tx("x", 1, -1, "acc_unknown")]),
        { now },
      ),
    ).rejects.toThrow(/foreign key/);
    expect(await ids()).toEqual(["a"]);
  },
);
