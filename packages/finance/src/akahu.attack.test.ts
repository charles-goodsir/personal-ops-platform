import { createTestDb, type Db } from "@ops/core";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { createAkahuClient } from "./akahu.js";
import { createFinanceApi } from "./read.js";
import { syncTransactions } from "./transactions.js";

// Batch C (C8) of the threat model: responses from a service I don't control, and
// the data they carry. Each test asserts the secure behaviour, so a failure is a
// finding.
const APP = "app_token_FAKE_SECRET";
const USER = "user_token_FAKE_SECRET";
const client = () => createAkahuClient({ appToken: APP, userToken: USER });
const json = (body: unknown, status = 200) => Response.json(body, { status });
afterEach(() => vi.unstubAllGlobals());

const account = {
  _id: "acc_1",
  name: "Everyday",
  status: "ACTIVE",
  type: "CHECKING",
  connection: { name: "Westpac" },
};
const tx = (over: Record<string, unknown> = {}) => ({
  _id: "tx_1",
  _account: "acc_1",
  date: "2026-09-10T11:59:00Z",
  description: "COUNTDOWN",
  amount: -10,
  type: "EFTPOS",
  ...over,
});

describe("C8: what is kept from a response", () => {
  test("account numbers, holder names and other people's numbers are dropped by the parser", async () => {
    vi.stubGlobal("fetch", async () =>
      json({
        items: [
          {
            ...account,
            formatted_account: "12-3456-1234567-00",
            meta: { holder: "CHARLES SECRET HOLDER" },
          },
        ],
      }),
    );
    const accounts = await client().listAccounts();
    expect(JSON.stringify(accounts)).not.toMatch(/1234567|SECRET HOLDER/);

    vi.stubGlobal("fetch", async () =>
      json({
        items: [
          tx({
            meta: { other_account: "98-7654-7654321-00", card_suffix: "9999" },
          }),
        ],
      }),
    );
    const txs = await client().listTransactions(new Date(0), new Date());
    expect(JSON.stringify(txs)).not.toMatch(/7654321|9999/);
  });
});

describe("C8: malformed responses fail cleanly", () => {
  const bad: [string, unknown][] = [
    ["items is not a list", { items: "nope" }],
    ["an amount as text", { items: [tx({ amount: "oops" })] }],
    ["a missing id", { items: [{ ...tx(), _id: undefined }] }],
    [
      "an unknown account status",
      { items: [{ ...account, status: "CLOSED" }] },
    ],
    ["null", null],
    ["an array", []],
  ];
  test.each(bad)("%s is an error that names no data", async (_n, body) => {
    vi.stubGlobal("fetch", async () => json(body));
    for (const call of [
      () => client().listAccounts(),
      () => client().listTransactions(new Date(0), new Date()),
    ]) {
      const err = await call().catch((e: unknown) => e);
      if (err instanceof Error) {
        expect(err.message).not.toMatch(/COUNTDOWN|oops/);
        expect(err.message).not.toContain("FAKE_SECRET");
      }
    }
  });

  test("an HTML error page is a status, not the page", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>Bad gateway SECRET-PAGE</html>", { status: 502 }),
    );
    const err = await client()
      .listAccounts()
      .catch((e: unknown) => e);
    expect(String(err)).toContain("502");
    expect(String(err)).not.toContain("SECRET-PAGE");
  });

  test("a failed request never carries the tokens, even if the runtime puts them in the message", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError(`fetch failed: Bearer ${USER} X-Akahu-Id ${APP}`);
    });
    const err = await client()
      .listAccounts()
      .catch((e: unknown) => e);
    expect(String(err)).not.toContain("FAKE_SECRET");
  });

  test("a cursor that never ends stops after a bounded number of pages", async () => {
    let pages = 0;
    vi.stubGlobal("fetch", async () => {
      pages++;
      if (pages > 2000) throw new Error("runaway: no page limit");
      return json({
        items: [tx({ _id: `tx_${pages}` })],
        cursor: { next: "again" },
      });
    });
    const result = await Promise.race([
      client()
        .listTransactions(new Date(0), new Date())
        .then(
          () => "finished",
          () => "refused",
        ),
      new Promise<string>((r) => setTimeout(() => r("still going"), 1500)),
    ]);
    expect(result).toBe("refused");
    expect(pages).toBeLessThan(2000);
  });

  test("pages with a new cursor each time stop at the page limit", async () => {
    let pages = 0;
    vi.stubGlobal("fetch", async () => {
      pages++;
      if (pages > 2000) throw new Error("runaway: no page limit"); // fail, don't fill the memory
      return json({ items: [], cursor: { next: `c${pages}` } });
    });
    const err = await client()
      .listTransactions(new Date(0), new Date())
      .catch((e: unknown) => e);
    expect(String(err)).toContain("too many pages");
    expect(pages).toBeLessThanOrEqual(501);
  });

  test("a request that never answers is given a deadline", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return json({ items: [] });
    });
    await client().listAccounts();
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

const run = process.env.DATABASE_URL ? describe : describe.skip;
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  testDb = await createTestDb("attack_akahu");
  if (!testDb) return;
  db = testDb.db;
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc_1', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
});
afterAll(() => testDb?.drop());

run("C8: hostile transactions and the database", () => {
  const fromAkahu = (items: unknown[]) => ({
    listTransactions: async () => items.map((i) => i as never),
  });
  const opts = {
    historyStart: new Date("2026-01-01T00:00:00Z"),
    now: new Date("2026-10-12T00:00:00Z"),
  };
  const count = async () =>
    Number((await db.query("SELECT count(*) FROM transactions")).rows[0].count);

  test("two transactions with the same id fail the whole sync and change nothing", async () => {
    const before = await count();
    await expect(
      syncTransactions(
        db,
        fromAkahu([tx(), tx({ description: "DUPE" })]),
        opts,
      ),
    ).rejects.toThrow();
    expect(await count()).toBe(before);
  });

  test("a date that is not a date is dropped, not stored", async () => {
    const before = await count();
    await syncTransactions(
      db,
      fromAkahu([tx({ _id: "bad_date", date: "not a date" })]),
      opts,
    );
    expect(await count()).toBe(before);
  });

  test("a rule that only matches the masked text is applied once, not cleared and reapplied", async () => {
    await db.query(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, synced_at)
       VALUES ('masked_1', 'acc_1', '2026-09-11T11:59:00Z', 'PAY 4835123456', -5, 'EFTPOS', now())`,
    );
    await db.query(
      `INSERT INTO category_rules (pattern, category) VALUES ('[number]', 'Other')`,
    );
    const { applyRules } = await import("./categorise.js");
    await applyRules(db);
    const second = await applyRules(db);
    expect(second.cleared).toBe(0);
    const { rows } = await db.query(
      `SELECT category FROM transactions WHERE akahu_id = 'masked_1'`,
    );
    expect(rows[0].category).toBe("Other");
    await db.query(`DELETE FROM category_rules`);
    await db.query(`DELETE FROM transactions WHERE akahu_id = 'masked_1'`);
  });

  test("a huge description is stored but the tools show a bounded line", async () => {
    await syncTransactions(
      db,
      fromAkahu([tx({ _id: "long", description: "L".repeat(200_000) })]),
      opts,
    );
    const rows = await createFinanceApi(db).getTransactions({ limit: 10 });
    expect(rows.every((r) => r.description.length <= 300)).toBe(true);
  });
});
