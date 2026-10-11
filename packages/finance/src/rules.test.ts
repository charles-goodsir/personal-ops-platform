import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Category } from "./categories.js";
import { createRulesApi } from "./rules.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("rules");
});
afterAll(() => testDb?.drop());

beforeEach(async () => {
  if (!testDb) return;
  const db = getDb();
  await db.query("TRUNCATE transactions, accounts, category_rules");
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  await db.query(
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type,
       category, category_source, synced_at)
     VALUES ('t1', 'acc', now(), 'SOUTHERN CROSS PET AC', -30, 'DIRECT DEBIT', 'Other', 'model', now()),
            ('t2', 'acc', now(), 'SOUTHERN CROSS PET AC', -30, 'DIRECT DEBIT', 'Other', 'model', now()),
            ('t3', 'acc', now(), 'COUNTDOWN', -40, 'EFTPOS', 'Groceries', 'model', now())`,
  );
});

const live = () => (testDb ? createRulesApi(getDb()) : undefined);
const categoryOf = async (id: string) =>
  (
    await getDb().query(
      "SELECT category, category_source FROM transactions WHERE akahu_id = $1",
      [id],
    )
  ).rows[0];

test.skipIf(!process.env.DATABASE_URL)(
  "adding a rule normalises it and applies it at once",
  async () => {
    const result = await live()?.addRule("  Southern Cross PET ", "Insurance");
    expect(result).toEqual({
      pattern: "southern cross pet",
      category: "Insurance",
      replaced: null,
      matches: 2,
      changed: 2,
    });
    expect(await categoryOf("t1")).toEqual({
      category: "Insurance",
      category_source: "rule",
    });
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "adding the same pattern again replaces its category",
  async () => {
    await live()?.addRule("countdown", "Eating out");
    const result = await live()?.addRule("COUNTDOWN", "Groceries");
    expect(result).toMatchObject({
      replaced: "Eating out",
      category: "Groceries",
      changed: 1,
    });
    expect(await live()?.listRules()).toMatchObject([
      { pattern: "countdown", category: "Groceries", matches: 1 },
    ]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "removing a rule sends its transactions back to the model",
  async () => {
    await live()?.addRule("southern cross pet", "Insurance");
    expect(await live()?.removeRule("Southern Cross Pet")).toEqual({
      pattern: "southern cross pet",
      removed: true,
      uncategorised: 2,
      recategorised: 0,
    });
    expect(await categoryOf("t1")).toEqual({
      category: null,
      category_source: null,
    });
    expect(await live()?.removeRule("southern cross pet")).toEqual({
      pattern: "southern cross pet",
      removed: false,
      uncategorised: 0,
    });
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "rejects bad input before touching the table",
  async () => {
    await expect(live()?.addRule("x", "Insurance")).rejects.toThrow(/2 to 100/);
    await expect(live()?.addRule("pet", "Bribes" as Category)).rejects.toThrow(
      /unknown category/,
    );
    expect(await live()?.listRules()).toEqual([]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "percent and underscore are plain text, not wildcards",
  async () => {
    expect(
      await live()
        ?.addRule("%", "Travel")
        .catch(() => "too short"),
    ).toBe("too short");
    const result = await live()?.addRule("_%", "Travel");
    expect(result?.matches).toBe(0);
    expect(await categoryOf("t3")).toEqual({
      category: "Groceries",
      category_source: "model",
    });
  },
);
