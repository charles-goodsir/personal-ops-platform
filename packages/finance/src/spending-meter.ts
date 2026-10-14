import type { Db } from "@ops/core";
import { dateRange } from "./periods.js";
import { discretionary, lastPayday } from "./payday-plan.js";
import type { PaydaySettings } from "./payday-settings.js";
import { createFinanceApi } from "./read.js";

const DAY = 86_400_000;
const FORTNIGHT = 14;

export type Meter = {
  payday: string; // the payday this fortnight started on
  spent: number;
  target: number;
  percent: number; // whole number, rounded down, can pass 100
  daysLeft: number; // days until the next payday
};

const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;

// The spending so far in the current fortnight: from the day after the last
// payday to `today`, leaving out what rent and bills stand for. Payday itself
// belongs to the fortnight that just ended (see fortnightWindow), so on payday
// the new fortnight is empty. Null when the payday or the target is not set,
// or the first payday has not come yet.
export async function currentMeter(
  db: Db,
  settings: PaydaySettings,
  today: string,
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
  };
}
