import type { Db } from "@ops/core";
import { dateRange } from "./periods.js";
import {
  discretionary,
  lastPayday,
  RENT_BILLS_CATEGORIES,
} from "./payday-plan.js";
import type { PaydaySettings } from "./payday-settings.js";
import { createFinanceApi } from "./read.js";

const DAY = 86_400_000;
const FORTNIGHT = 14;
// The pending list is refreshed at every sync, so one older than this means the
// fetch has been failing, and it is left out rather than shown as current.
const PENDING_MAX_AGE_MS = 26 * 3_600_000;
// Not spending money, as in the settled totals.
const NOT_SPENDING = [...RENT_BILLS_CATEGORIES, "Transfers", "Investments"];

export type Meter = {
  payday: string; // the payday this fortnight started on
  spent: number;
  target: number;
  percent: number; // whole number, rounded down, can pass 100
  daysLeft: number; // days until the next payday
  // Charges the bank has not settled yet, about what they will be. Null when
  // there is no recent list. Never counted in spent or percent, and never alerted on.
  pending: { spent: number; count: number; percent: number } | null;
};

const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;

// The pending charges dated in the fortnight so far, with the same exclusions
// as the settled spending. A pending charge has no category until a rule of
// mine matches it, so an unmatched one counts as spending.
async function pendingSpending(
  db: Db,
  from: string,
  today: string,
  target: number,
  settled: number,
  now: Date,
): Promise<Meter["pending"]> {
  const counted = `amount < 0 AND type <> 'TRANSFER'
    AND coalesce(category, '') <> ALL($3)
    AND (date AT TIME ZONE 'Pacific/Auckland')::date BETWEEN $1 AND $2`;
  const { rows } = await db.query<{
    fetched: Date | null;
    n: number;
    spent: string;
  }>(
    `SELECT max(fetched_at) AS fetched,
            count(*) FILTER (WHERE ${counted})::int AS n,
            coalesce(sum(-amount) FILTER (WHERE ${counted}), 0) AS spent
     FROM pending_transactions`,
    [from, today, NOT_SPENDING],
  );
  const r = rows[0];
  if (!r?.fetched || now.getTime() - r.fetched.getTime() > PENDING_MAX_AGE_MS)
    return null;
  const spent = Number(r.spent);
  return {
    spent,
    count: r.n,
    // Whole cents, so a total of exactly the target is 100% and not 99.
    percent: Math.floor(
      ((Math.round(settled * 100) + Math.round(spent * 100)) * 100) /
        Math.round(target * 100),
    ),
  };
}

// The spending so far in the current fortnight: from the day after the last
// payday to `today`, leaving out what rent and bills stand for. Payday itself
// belongs to the fortnight that just ended (see fortnightWindow), so on payday
// the new fortnight is empty. Null when the payday or the target is not set,
// or the first payday has not come yet.
export async function currentMeter(
  db: Db,
  settings: PaydaySettings,
  today: string,
  now = new Date(),
): Promise<Meter | null> {
  if (settings.payday === null || settings.spending === null) return null;
  const payday = lastPayday(settings.payday, today);
  if (payday === null) return null;
  const from = new Date(Date.parse(`${payday}T00:00:00Z`) + DAY)
    .toISOString()
    .slice(0, 10);
  const spent =
    from > today
      ? 0
      : discretionary(
          await createFinanceApi(db).getSpending(dateRange(from, today)),
        );
  return {
    payday,
    spent,
    target: settings.spending,
    // Rounded down, so 79.6% is not an 80% alert.
    percent: Math.floor((spent / settings.spending) * 100),
    daysLeft: FORTNIGHT - daysBetween(payday, today),
    // Payday itself belongs to the fortnight that ended, so nothing is pending in a new one.
    pending:
      from > today
        ? { spent: 0, count: 0, percent: 0 }
        : await pendingSpending(db, from, today, settings.spending, spent, now),
  };
}
