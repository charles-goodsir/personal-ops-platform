import type { Db } from "@ops/core";
import { nzDate } from "./payday-plan.js";
import type { PaydaySettings } from "./payday-settings.js";
import { currentMeter } from "./spending-meter.js";

const LEVELS = [100, 80] as const;
const levelOf = (percent: number) => LEVELS.find((l) => percent >= l) ?? 0;
const nzd = (n: number) => `$${n.toFixed(2)}`;

// After a sync: one message when this fortnight's spending first reaches 80%
// of the target, and one when it first reaches 100%. The level only goes up
// within a fortnight, so spending dropping back never repeats an alert. The
// state is saved after the send, so a failed send is tried again on the next
// sync. Returns the level sent, or 0.
export async function checkSpendingAlert(
  db: Db,
  settings: PaydaySettings,
  send: (text: string) => Promise<void>,
  now = new Date(),
): Promise<number> {
  const meter = await currentMeter(db, settings, nzDate(now));
  if (meter === null) return 0;
  const level = levelOf(meter.percent);
  const { rows } = await db.query<{
    alert_payday: string | null;
    alert_level: number;
  }>(
    "SELECT to_char(alert_payday, 'YYYY-MM-DD') AS alert_payday, alert_level FROM payday_settings",
  );
  const sent = rows[0]?.alert_payday === meter.payday ? rows[0].alert_level : 0;
  if (level <= sent) return 0;

  const figures = `${nzd(meter.spent)} of ${nzd(meter.target)} (${meter.percent}%), ${meter.daysLeft} days to payday`;
  await send(
    level === 100
      ? `Spending alert\nOver the spending target this fortnight: ${figures}.`
      : `Spending alert\nUsed ${meter.percent}% of the spending target this fortnight: ${figures}.`,
  );
  await db.query(
    "UPDATE payday_settings SET alert_payday = $1, alert_level = $2",
    [meter.payday, level],
  );
  return level;
}
