import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { replacePending } from "./pending.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("pending");
});
afterAll(() => testDb?.drop());
beforeEach(async () => {
  if (testDb) await getDb().query("TRUNCATE pending_transactions");
});

const item = (over: Record<string, unknown> = {}) => ({
  date: "2026-10-15T10:59:00Z",
  description: "COUNTDOWN",
  amount: -12.5,
  type: "EFTPOS",
  ...over,
});
const rows = async () =>
  (
    await getDb().query<{ description: string; amount: string }>(
      "SELECT description, amount FROM pending_transactions ORDER BY id",
    )
  ).rows;
const run = test.skipIf(!process.env.DATABASE_URL);

run(
  "each call replaces what was there, and an empty list clears it",
  async () => {
    expect(await replacePending(getDb(), [item(), item({ amount: -3 })])).toBe(
      2,
    );
    expect(await rows()).toHaveLength(2);
    expect(
      await replacePending(getDb(), [item({ description: "NEW WORLD" })]),
    ).toBe(1);
    expect(await rows()).toEqual([
      { description: "NEW WORLD", amount: "-12.50" },
    ]);
    await replacePending(getDb(), []);
    expect(await rows()).toEqual([]);
  },
);

run("a failure part way keeps the old rows", async () => {
  await replacePending(getDb(), [item({ description: "KEEP ME" })]);
  await expect(
    replacePending(getDb(), [
      item({ description: "FIRST" }),
      item({ amount: 1e12 }), // over the table's limit
    ]),
  ).rejects.toThrow();
  expect(await rows()).toEqual([{ description: "KEEP ME", amount: "-12.50" }]);
});

run("the description is masked and cut short before it is stored", async () => {
  await replacePending(getDb(), [
    item({ description: "PAYMENT 4111 1111 1111 1111 REF 12345678" }),
    item({ description: "A".repeat(500) }),
  ]);
  const [first, second] = await rows();
  expect(first?.description).toBe("PAYMENT [number] REF [number]");
  expect(first?.description).not.toMatch(/4111|12345678/);
  expect(second?.description).toHaveLength(300);
});
