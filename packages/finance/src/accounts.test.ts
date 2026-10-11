import { createTestDb } from "@ops/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { syncAccounts } from "./accounts.js";
import type { AkahuAccount } from "./akahu.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  testDb = await createTestDb("accounts");
});
afterAll(() => testDb?.drop());
const getDb = () => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};

const account = (balance: number): AkahuAccount => ({
  _id: "acc_1",
  name: "Everyday",
  status: "ACTIVE",
  type: "CHECKING",
  connection: { name: "ANZ" },
  balance: { currency: "NZD", current: balance, available: balance - 20 },
  refreshed: { transactions: "2026-10-11T00:00:00Z" },
});

test.skipIf(!process.env.DATABASE_URL)(
  "inserts then updates by Akahu id",
  async () => {
    const db = getDb();
    expect(
      await syncAccounts(db, { listAccounts: async () => [account(100)] }),
    ).toBe(1);
    await syncAccounts(db, { listAccounts: async () => [account(250.75)] });
    const { rows } = await db.query(
      "SELECT akahu_id, bank, type, balance_current, balance_available FROM accounts",
    );
    expect(rows).toEqual([
      {
        akahu_id: "acc_1",
        bank: "ANZ",
        type: "CHECKING",
        balance_current: "250.75",
        balance_available: "230.75",
      },
    ]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "the table has nowhere to store an account number",
  async () => {
    const { rows } = await getDb().query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts' AND table_schema = current_schema()",
    );
    expect(rows.map((r) => r.column_name)).not.toContain("formatted_account");
  },
);
