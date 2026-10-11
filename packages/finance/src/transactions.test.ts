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

const DAY = 86_400_000;
const now = new Date("2026-10-11T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);
const historyStart = daysAgo(365);
const opts = { now, historyStart };

const tx = (
  id: string,
  age: number,
  amount = -10,
  account = "acc_live",
): AkahuTransaction => ({
  _id: id,
  _account: account,
  date: daysAgo(age).toISOString(),
  description: `SHOP ${id}`,
  amount,
  type: "EFTPOS",
});

const addAccount = (id: string, status = "ACTIVE") =>
  getDb().query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ($1, $1, 'Westpac', 'CHECKING', $2, 'NZD', now())`,
    [id, status],
  );

beforeEach(async () => {
  if (!testDb) return;
  await getDb().query("TRUNCATE transactions, accounts");
  await addAccount("acc_live");
});

const akahuWith = (items: AkahuTransaction[]) => ({
  listTransactions: vi.fn(async () => items),
});
const fetchStart = (akahu: ReturnType<typeof akahuWith>) =>
  (akahu.listTransactions.mock.calls[0] as unknown as [Date, Date])[0];
const ids = async () =>
  (
    await getDb().query<{ akahu_id: string }>(
      "SELECT akahu_id FROM transactions ORDER BY 1",
    )
  ).rows.map((r) => r.akahu_id);

test.skipIf(!process.env.DATABASE_URL)(
  "first run reads from the history start, later runs read the window",
  async () => {
    const first = akahuWith([tx("old", 300), tx("recent", 2)]);
    expect(await syncTransactions(getDb(), first, opts)).toMatchObject({
      days: 365,
      added: 2,
    });
    // Akahu's start is exclusive, so the request starts 1ms early.
    expect(fetchStart(first)).toEqual(new Date(historyStart.getTime() - 1));

    const second = akahuWith([tx("recent", 2)]);
    expect(await syncTransactions(getDb(), second, opts)).toMatchObject({
      days: 14,
      added: 0,
      updated: 0,
      removed: 0,
    });
    // "old" is outside the window, so not seeing it again isn't a deletion.
    expect(await ids()).toEqual(["old", "recent"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "a newly connected account gets the full history",
  async () => {
    await syncTransactions(getDb(), akahuWith([tx("a", 1)]), opts);
    await addAccount("acc_card", "INACTIVE");
    const akahu = akahuWith([tx("a", 1), tx("card", 200, -50, "acc_card")]);
    expect(await syncTransactions(getDb(), akahu, opts)).toMatchObject({
      days: 365,
      added: 1,
    });
    expect(await ids()).toEqual(["a", "card"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "nothing before the history start is stored, and older rows are pruned",
  async () => {
    // Stored under an earlier, longer history setting.
    await syncTransactions(
      getDb(),
      akahuWith([tx("ancient", 500), tx("a", 1)]),
      {
        now,
        historyStart: daysAgo(730),
      },
    );
    const result = await syncTransactions(
      getDb(),
      akahuWith([tx("ancient", 500), tx("a", 1)]),
      opts,
    );
    expect(result).toMatchObject({ pruned: 1 });
    expect(await ids()).toEqual(["a"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)("counts real changes only", async () => {
  await syncTransactions(getDb(), akahuWith([tx("a", 1), tx("b", 1)]), opts);
  const result = await syncTransactions(
    getDb(),
    akahuWith([tx("a", 1, -99), tx("b", 1), tx("c", 1)]),
    opts,
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
    await syncTransactions(
      getDb(),
      akahuWith([tx("keep", 300), tx("v1", 3)]),
      opts,
    );
    const result = await syncTransactions(
      getDb(),
      akahuWith([tx("v2", 3)]),
      opts,
    );
    expect(result).toMatchObject({ added: 1, removed: 1 });
    expect(await ids()).toEqual(["keep", "v2"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "an inactive account's transactions are never deleted",
  async () => {
    await addAccount("acc_gone", "INACTIVE");
    await syncTransactions(
      getDb(),
      akahuWith([tx("live", 2), tx("gone", 2, -5, "acc_gone")]),
      opts,
    );
    const result = await syncTransactions(
      getDb(),
      akahuWith([tx("live", 2)]),
      opts,
    );
    expect(result.removed).toBe(0);
    expect(await ids()).toEqual(["gone", "live"]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "a failing insert rolls back, leaving the table as it was",
  async () => {
    await syncTransactions(getDb(), akahuWith([tx("a", 1)]), opts);
    // Unknown account: the foreign key fails after the upsert has started.
    await expect(
      syncTransactions(
        getDb(),
        akahuWith([tx("b", 1), tx("x", 1, -1, "acc_unknown")]),
        opts,
      ),
    ).rejects.toThrow(/foreign key/);
    expect(await ids()).toEqual(["a"]);
  },
);
