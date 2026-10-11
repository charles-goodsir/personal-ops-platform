import { createLogger, createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  applyRules,
  categoriseWithModel,
  maskDigits,
  type Classifier,
} from "./categorise.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
const logger = createLogger({ LOG_LEVEL: "fatal" });
beforeAll(async () => {
  testDb = await createTestDb("categorise");
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
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, merchant, synced_at)
     VALUES ('t1', 'acc', now(), 'COUNTDOWN PONSONBY 4835123456', -52.10, 'EFTPOS', 'Countdown', now()),
            ('t2', 'acc', now() - interval '1 day', 'Z ENERGY AUCKLAND', -80, 'EFTPOS', NULL, now()),
            ('t3', 'acc', now() - interval '2 days', 'SALARY ACME LTD', 4200, 'DIRECT CREDIT', NULL, now())`,
  );
});

const categories = async () =>
  Object.fromEntries(
    (
      await getDb().query<{
        akahu_id: string;
        category: string | null;
        category_source: string | null;
      }>(
        "SELECT akahu_id, category, category_source FROM transactions ORDER BY 1",
      )
    ).rows.map((r) => [
      r.akahu_id,
      r.category && `${r.category}/${r.category_source}`,
    ]),
  );

const addRule = (pattern: string, category: string) =>
  getDb().query(
    "INSERT INTO category_rules (pattern, category) VALUES ($1, $2)",
    [pattern, category],
  );

test("maskDigits hides runs of 6 or more digits only", () => {
  expect(maskDigits("COUNTDOWN 4835123456 STORE 12")).toBe(
    "COUNTDOWN [number] STORE 12",
  );
});

test.skipIf(!process.env.DATABASE_URL)(
  "rules match description or merchant, longest pattern wins",
  async () => {
    await addRule("countdown", "Groceries");
    await addRule("countdown ponsonby", "Eating out"); // longer, so it wins for t1
    await addRule("energy", "Fuel");
    expect(await applyRules(getDb())).toEqual({ applied: 2, cleared: 0 });
    expect(await categories()).toEqual({
      t1: "Eating out/rule",
      t2: "Fuel/rule",
      t3: null,
    });
    // Nothing changed, so nothing is rewritten.
    expect(await applyRules(getDb())).toEqual({ applied: 0, cleared: 0 });
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "deleting a rule clears what it set",
  async () => {
    await addRule("energy", "Fuel");
    await applyRules(getDb());
    await getDb().query("DELETE FROM category_rules");
    expect(await applyRules(getDb())).toEqual({ applied: 0, cleared: 1 });
    expect((await categories()).t2).toBeNull();
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "the model gets masked text and only fills the gaps",
  async () => {
    await addRule("energy", "Fuel");
    await applyRules(getDb());
    const classify = vi.fn<Classifier>(async (items) =>
      items.map((i) => ({
        id: i.id,
        category: i.amount > 0 ? "Income" : "Groceries",
      })),
    );
    expect(await categoriseWithModel(getDb(), classify, logger)).toEqual({
      pending: 2,
      categorised: 2,
    });
    const sent = classify.mock.calls.flatMap(([items]) => items);
    expect(sent.map((i) => i.description)).toEqual([
      "COUNTDOWN PONSONBY [number]",
      "SALARY ACME LTD",
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/4835123456|t1|acc/);
    expect(await categories()).toEqual({
      t1: "Groceries/model",
      t2: "Fuel/rule",
      t3: "Income/model",
    });
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "a later rule overrides the model",
  async () => {
    await categoriseWithModel(
      getDb(),
      async (items) => items.map((i) => ({ id: i.id, category: "Other" })),
      logger,
    );
    await addRule("countdown", "Groceries");
    await applyRules(getDb());
    expect((await categories()).t1).toBe("Groceries/rule");
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "ids outside the batch are ignored, missing ones retried",
  async () => {
    const classify: Classifier = async () => [
      { id: 0, category: "Groceries" },
      { id: 99, category: "Travel" },
    ];
    expect(await categoriseWithModel(getDb(), classify, logger)).toEqual({
      pending: 3,
      categorised: 1,
    });
    expect(await categories()).toEqual({
      t1: "Groceries/model",
      t2: null,
      t3: null,
    });
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "a failed batch stops the run and keeps earlier batches",
  async () => {
    const classify = vi
      .fn<Classifier>()
      .mockResolvedValueOnce([{ id: 0, category: "Groceries" }])
      .mockRejectedValueOnce(new Error("rate limited"));
    expect(
      await categoriseWithModel(getDb(), classify, logger, { batchSize: 1 }),
    ).toEqual({
      pending: 3,
      categorised: 1,
    });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(await categories()).toEqual({
      t1: "Groceries/model",
      t2: null,
      t3: null,
    });
  },
);
