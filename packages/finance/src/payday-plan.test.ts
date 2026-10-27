import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  allocateToGoals,
  biggestCharge,
  computePlan,
  discretionary,
  fortnightSpent,
  fortnightWindow,
  lastPayday,
} from "./payday-plan.js";
import type { PaydaySettings } from "./payday-settings.js";

// Round numbers on purpose: pay 1000, rent 300, savings 200, investments 50,
// so 450 is left to spend.
const settings = (over: Partial<PaydaySettings> = {}): PaydaySettings => ({
  pay: 1000,
  rent: 300,
  savings: 200,
  invest: 50,
  spending: null,
  payday: "2026-10-13",
  ...over,
});
const ready = (p: ReturnType<typeof computePlan>) => {
  if (!p.ready) throw new Error("not ready");
  return p;
};
const goal = (name: string, target: number, saved = 0, weight = 1) => ({
  name,
  target,
  saved,
  weight,
});

test("under the allowance: the unspent part is added to savings and investments in their usual ratio", () => {
  const p = ready(computePlan(settings(), 350, []));
  expect(p).toMatchObject({
    allowance: 45000,
    target: 45000,
    spent: 35000,
    standing: "under",
    surplus: 10000,
    over: 0,
    savings: 28000, // 20000 and 8000 of the 10000 surplus
    invest: 7000, // 5000 and 2000
    shortfall: 0,
  });
});

test("over the target: the plan stays at the usual amounts and says by how much", () => {
  const p = ready(computePlan(settings(), 500, []));
  expect(p).toMatchObject({
    standing: "over",
    surplus: 0,
    over: 5000,
    savings: 20000,
    invest: 5000,
  });
  expect(ready(computePlan(settings(), 450, []))).toMatchObject({
    standing: "on",
    surplus: 0,
    over: 0,
  });
});

test("a lower spending target counts: only what is left under the target is added", () => {
  const p = ready(computePlan(settings({ spending: 400 }), 350, []));
  expect(p).toMatchObject({ target: 40000, standing: "under", surplus: 5000 });
  expect(
    ready(computePlan(settings({ spending: 400 }), 420, [])),
  ).toMatchObject({ standing: "over", over: 2000 });
});

test("a target above the money available is cut to what is available", () => {
  const p = ready(computePlan(settings({ spending: 9999 }), 100, []));
  expect(p.target).toBe(45000);
  expect(p.surplus).toBe(35000);
});

test("when the pay does not cover the usual amounts it says how far short, and adds nothing", () => {
  const p = ready(computePlan(settings({ pay: 500 }), 0, []));
  expect(p).toMatchObject({
    allowance: 0,
    shortfall: 5000,
    target: 0,
    surplus: 0,
    savings: 20000,
    invest: 5000,
  });
});

test("a setting that is missing is listed, and nothing is worked out", () => {
  expect(computePlan(settings({ pay: null, invest: null }), 100, [])).toEqual({
    ready: false,
    missing: ["pay", "invest"],
  });
});

test("cents never go missing: an odd surplus rounds with the odd cent going to savings", () => {
  const p = ready(computePlan(settings(), 349.99, []));
  expect(p.surplus).toBe(10001);
  expect(p.invest - 5000).toBe(2000); // 10001 * 50 / 250 = 2000.2
  expect(p.savings - 20000).toBe(8001);
  expect(p.savings + p.invest).toBe(20000 + 5000 + 10001);
});

test("goals share the savings by weight, never take more than they need, and hand the rest on", () => {
  expect(
    allocateToGoals(8000, [
      goal("A", 1000, 0, 3),
      goal("B", 1000, 0, 1),
    ]).shares.map((s) => s.cents),
  ).toEqual([6000, 2000]);
  // A needs only 10.00 more, so B takes the rest.
  const capped = allocateToGoals(8000, [goal("A", 100, 90), goal("B", 1000)]);
  expect(capped.shares.map((s) => s.cents)).toEqual([1000, 7000]);
  expect(capped.shares[0]?.reaches).toBe(true);
  expect(capped.unallocated).toBe(0);
});

test("a goal already at its target gets nothing, and savings with nowhere to go are left unallocated", () => {
  const done = allocateToGoals(5000, [
    goal("Done", 100, 100),
    goal("Over", 100, 150),
  ]);
  expect(done.shares.map((s) => s.cents)).toEqual([0, 0]);
  expect(done.unallocated).toBe(5000);
  const small = allocateToGoals(50000, [goal("A", 100), goal("B", 200)]);
  expect(small.shares.map((s) => s.cents)).toEqual([10000, 20000]);
  expect(small.unallocated).toBe(20000);
  expect(allocateToGoals(5000, []).unallocated).toBe(5000);
});

test("three equal goals share an odd amount in whole cents, the extra cent going to the earliest", () => {
  const r = allocateToGoals(10000, [
    goal("A", 9999),
    goal("B", 9999),
    goal("C", 9999),
  ]);
  expect(r.shares.map((s) => s.cents)).toEqual([3334, 3333, 3333]);
});

test("whatever the inputs, the parts add up, nothing goes negative and no goal is overfilled", () => {
  let seed = 12345;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let run = 0; run < 500; run++) {
    const goals = Array.from({ length: rand(5) }, (_, i) =>
      goal(
        `G${i}`,
        rand(500000) / 100 + 0.01,
        rand(400000) / 100,
        rand(10) + 1,
      ),
    );
    const s = settings({
      pay: rand(300000) / 100 + 1,
      rent: rand(100000) / 100 + 1,
      savings: rand(100000) / 100 + 1,
      invest: rand(50000) / 100 + 1,
      spending: rand(2) ? rand(200000) / 100 + 1 : null,
    });
    const p = ready(computePlan(s, rand(300000) / 100, goals));
    expect(p.savings + p.invest, JSON.stringify({ s, goals })).toBe(
      p.base.savings + p.base.invest + p.surplus,
    );
    expect(p.surplus * p.over).toBe(0);
    expect(p.goals.reduce((t, g) => t + g.cents, 0) + p.unallocated).toBe(
      p.savings,
    );
    for (const [i, g] of p.goals.entries()) {
      const need = Math.max(
        0,
        Math.round((goals[i]?.target ?? 0) * 100) -
          Math.round((goals[i]?.saved ?? 0) * 100),
      );
      expect(g.cents).toBeGreaterThanOrEqual(0);
      expect(g.cents).toBeLessThanOrEqual(need);
    }
    for (const n of [
      p.savings,
      p.invest,
      p.surplus,
      p.over,
      p.unallocated,
      p.target,
      p.spent,
    ])
      expect(Number.isInteger(n) && n >= 0).toBe(true);
  }
});

test("paydays fall every 14 days from the anchor, and the window is the 14 days ending on payday", () => {
  const anchor = "2026-10-13";
  expect(lastPayday(anchor, "2026-10-12")).toBeNull();
  expect(lastPayday(anchor, "2026-10-13")).toBe("2026-10-13");
  expect(lastPayday(anchor, "2026-10-14")).toBe("2026-10-13");
  expect(lastPayday(anchor, "2026-10-26")).toBe("2026-10-13");
  expect(lastPayday(anchor, "2026-10-27")).toBe("2026-10-27");
  expect(lastPayday(anchor, "2027-01-01")).toBe("2026-12-22"); // across the new year
  expect(fortnightWindow("2026-10-27")).toEqual({
    from: "2026-10-14",
    to: "2026-10-27",
  });
  expect(fortnightWindow("2026-03-02")).toEqual({
    from: "2026-02-17",
    to: "2026-03-02",
  });
});

test("discretionary spending leaves out the categories rent and bills sit in", () => {
  expect(
    discretionary({
      range: { from: new Date(), to: new Date(), label: "x" },
      total: 1000,
      income: 0,
      invested: 0,
      byCategory: [
        { category: "Housing", spent: 400, count: 1 },
        { category: "Utilities", spent: 100, count: 2 },
        { category: "Insurance", spent: 50.5, count: 1 },
        { category: "Groceries", spent: 300, count: 8 },
      ],
      uncategorised: 149.5, // inside the total, and counts as spending
    }),
  ).toBe(449.5);
});

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("payday_plan");
});
afterAll(() => testDb?.drop());
beforeEach(async () => {
  if (!testDb) return;
  const db = getDb();
  await db.query("TRUNCATE transactions, accounts");
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
});

test.skipIf(!process.env.DATABASE_URL)(
  "the fortnight's spending counts both end days, and leaves out the days around it, rent and bills, transfers, investments and income",
  async () => {
    const rows: [string, number, string | null][] = [
      ["2026-10-13", -999, "Groceries"], // the day before the window
      ["2026-10-14", -10, "Groceries"], // first day
      ["2026-10-20", -20, null], // uncategorised
      ["2026-10-27", -30, "Eating out"], // payday itself
      ["2026-10-28", -999, "Groceries"], // the day after
      ["2026-10-15", -400, "Housing"],
      ["2026-10-16", -60, "Utilities"],
      ["2026-10-17", -40, "Insurance"],
      ["2026-10-18", -500, "Transfers"],
      ["2026-10-19", -150, "Investments"],
      ["2026-10-21", 1000, "Income"],
    ];
    for (const [i, [date, amount, category]] of rows.entries())
      await getDb().query(
        `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
         VALUES ($1, 'acc', $2::date + time '10:59', 'X', $3, 'EFTPOS', $4, now())`,
        [`t${i}`, date, amount, category],
      );
    expect(await fortnightSpent(getDb(), "2026-10-27")).toBe(60);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "the biggest charge is the largest counted one: not outside the window, rent and bills, transfers, investments or income",
  async () => {
    expect(await biggestCharge(getDb(), "2026-10-27")).toBeNull();
    const rows: [string, number, string | null][] = [
      ["2026-10-13", -999, "Groceries"], // the day before the window
      ["2026-10-14", -10, "Groceries"],
      ["2026-10-20", -45, null], // uncategorised counts
      ["2026-10-27", -30, "Eating out"],
      ["2026-10-15", -400, "Housing"],
      ["2026-10-18", -500, "Transfers"],
      ["2026-10-19", -150, "Investments"],
      ["2026-10-21", 1000, "Income"],
    ];
    for (const [i, [date, amount, category]] of rows.entries())
      await getDb().query(
        `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
         VALUES ($1, 'acc', $2::date + time '10:59', 'X', $3, 'EFTPOS', $4, now())`,
        [`t${i}`, date, amount, category],
      );
    expect(await biggestCharge(getDb(), "2026-10-27")).toEqual({
      category: "Uncategorised",
      amount: 45,
    });
  },
);
