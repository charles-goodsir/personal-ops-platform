import type { Db } from "@ops/core";
import type { Goal } from "./goals.js";
import { dateRange } from "./periods.js";
import type { PaydaySettings } from "./payday-settings.js";
import { createFinanceApi, type Spending } from "./read.js";

// All money in this file is whole cents, so the parts always add up.

// Categories that the fixed rent and bills amount stands for. Spending in them
// is not "spending money". Transfers and Investments are already left out of
// spending, and Income is not spending.
export const RENT_BILLS_CATEGORIES = ["Housing", "Utilities", "Insurance"];

const DAY = 86_400_000;
const FORTNIGHT = 14;

const cents = (dollars: number) => Math.round(dollars * 100);

// A date in New Zealand as "YYYY-MM-DD".
export const nzDate = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(at);

export type GoalShare = { name: string; cents: number; reaches: boolean };

export type Plan =
  | { ready: false; missing: string[] }
  | {
      ready: true;
      pay: number;
      rent: number;
      base: { savings: number; invest: number };
      allowance: number; // pay less rent and the usual savings and investments
      shortfall: number; // how far the pay falls short of those, 0 when it covers them
      target: number; // spending target, never more than the allowance
      spent: number;
      standing: "under" | "on" | "over";
      surplus: number; // target less spending, when under
      over: number; // spending less target, when over
      savings: number; // usual savings plus its share of the surplus
      invest: number;
      goals: GoalShare[];
      unallocated: number; // savings no goal can take
    };

// Splits `total` cents across goals by weight. A goal never gets more than it
// still needs, and what it cannot take goes to the others. Whole cents, with the
// odd cents to the goals with the biggest leftover fraction, then by order.
export function allocateToGoals(
  total: number,
  goals: Pick<Goal, "name" | "target" | "saved" | "weight">[],
): { shares: GoalShare[]; unallocated: number } {
  const need = goals.map((g) => Math.max(0, cents(g.target) - cents(g.saved)));
  const give = goals.map(() => 0);
  let pool = total;
  let open = goals.map((_, i) => i).filter((i) => (need[i] as number) > 0);

  while (pool > 0 && open.length > 0) {
    const weight = open.reduce((s, i) => s + (goals[i]?.weight ?? 0), 0);
    const share = (i: number) => (pool * (goals[i]?.weight ?? 0)) / weight;
    const full = open.filter(
      (i) => (need[i] as number) - (give[i] as number) <= share(i),
    );
    if (full.length > 0) {
      for (const i of full) {
        pool -= (need[i] as number) - (give[i] as number);
        give[i] = need[i] as number;
      }
      open = open.filter((i) => !full.includes(i));
      continue;
    }
    // Nobody is capped: share the pool in whole cents.
    const floors = open.map((i) => Math.floor(share(i)));
    let left = pool - floors.reduce((s, f) => s + f, 0);
    const order = open
      .map((i, k) => ({ i, k, frac: share(i) - (floors[k] as number) }))
      .sort((a, b) => b.frac - a.frac || a.k - b.k);
    open.forEach(
      (i, k) => (give[i] = (give[i] as number) + (floors[k] as number)),
    );
    for (const { i } of order) {
      if (left <= 0) break;
      give[i] = (give[i] as number) + 1;
      left -= 1;
    }
    pool = 0;
  }
  return {
    shares: goals.map((g, i) => ({
      name: g.name,
      cents: give[i] as number,
      reaches: cents(g.saved) + (give[i] as number) >= cents(g.target),
    })),
    unallocated: pool,
  };
}

// The plan for one payday. `spent` is what I spent in the fortnight that has
// just ended, in dollars, from `fortnightSpent`.
export function computePlan(
  settings: PaydaySettings,
  spent: number,
  goals: Pick<Goal, "name" | "target" | "saved" | "weight">[],
): Plan {
  const missing = (
    [
      ["pay", settings.pay],
      ["rent", settings.rent],
      ["savings", settings.savings],
      ["invest", settings.invest],
    ] as const
  )
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missing.length > 0) return { ready: false, missing };

  const pay = cents(settings.pay as number);
  const rent = cents(settings.rent as number);
  const baseSavings = cents(settings.savings as number);
  const baseInvest = cents(settings.invest as number);
  const available = pay - rent - baseSavings - baseInvest;
  const allowance = Math.max(0, available);
  const wanted =
    settings.spending === null ? allowance : cents(settings.spending);
  const target = Math.min(wanted, allowance);
  const spentCents = Math.max(0, cents(spent));

  const surplus = Math.max(0, target - spentCents);
  // The surplus follows the usual ratio of savings to investments. The odd cent
  // from rounding goes to savings.
  const surplusInvest = Math.round(
    (surplus * baseInvest) / (baseSavings + baseInvest),
  );
  const savings = baseSavings + (surplus - surplusInvest);
  const { shares, unallocated } = allocateToGoals(savings, goals);

  return {
    ready: true,
    pay,
    rent,
    base: { savings: baseSavings, invest: baseInvest },
    allowance,
    shortfall: Math.max(0, -available),
    target,
    spent: spentCents,
    standing:
      spentCents < target ? "under" : spentCents === target ? "on" : "over",
    surplus,
    over: Math.max(0, spentCents - target),
    savings,
    invest: baseInvest + surplusInvest,
    goals: shares,
    unallocated,
  };
}

// Today's NZ date as "YYYY-MM-DD" in, the latest payday on or before it. Paydays
// fall every 14 days from the anchor. Null before the first one.
export function lastPayday(anchor: string, today: string): string | null {
  const a = Date.parse(`${anchor}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  if (t < a) return null;
  const k = Math.floor((t - a) / (FORTNIGHT * DAY));
  return new Date(a + k * FORTNIGHT * DAY).toISOString().slice(0, 10);
}

// The 14 days ending on payday, both ends included.
export function fortnightWindow(payday: string): { from: string; to: string } {
  const end = Date.parse(`${payday}T00:00:00Z`);
  return {
    from: new Date(end - (FORTNIGHT - 1) * DAY).toISOString().slice(0, 10),
    to: payday,
  };
}

// Spending that is not rent or bills: the month's totals minus the categories
// the fixed amount stands for. Uncategorised spending counts.
export function discretionary(spending: Spending): number {
  const rentBills = spending.byCategory
    .filter((c) => RENT_BILLS_CATEGORIES.includes(c.category))
    .reduce((s, c) => s + cents(c.spent), 0);
  return (cents(spending.total) - rentBills) / 100;
}

// What I spent in the fortnight ending on `payday`, in dollars.
export async function fortnightSpent(db: Db, payday: string): Promise<number> {
  const { from, to } = fortnightWindow(payday);
  return discretionary(
    await createFinanceApi(db).getSpending(dateRange(from, to)),
  );
}

export type BigCharge = { category: string; amount: number };

// The largest single charge in the fortnight ending on `payday`, among the
// spending that counts toward the target. Category and dollars only: the payee
// stays out of the message. Null when there is no spending.
export async function biggestCharge(
  db: Db,
  payday: string,
): Promise<BigCharge | null> {
  const { from, to } = fortnightWindow(payday);
  const r = dateRange(from, to);
  const { rows } = await db.query<{ category: string | null; amount: string }>(
    `SELECT category, -amount AS amount FROM transactions
     WHERE date >= $1 AND date < $2 AND amount < 0
       AND coalesce(category, '') <> ALL($3::text[])
     ORDER BY amount LIMIT 1`,
    [r.from, r.to, [...RENT_BILLS_CATEGORIES, "Transfers", "Investments"]],
  );
  const row = rows[0];
  return row
    ? { category: row.category ?? "Uncategorised", amount: Number(row.amount) }
    : null;
}

// True when pay has arrived: an Income transaction dated payday that is at
// least 90% of the pay I set. Akahu stamps it 23:59:59 on the day, so it is in
// my data from the 00:05 sync that follows.
export async function paySeen(
  db: Db,
  payday: string,
  pay: number,
): Promise<boolean> {
  const { from, to } = dateRange(payday, payday);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM transactions
     WHERE category = 'Income' AND amount >= $3 AND date >= $1 AND date < $2`,
    [from, to, pay * 0.9],
  );
  return (rows[0]?.n ?? 0) > 0;
}
