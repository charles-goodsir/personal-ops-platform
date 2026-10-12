import type { Db } from "@ops/core";
import { createBudgetsApi } from "./budgets.js";
import { resolvePeriod } from "./periods.js";

const LEVELS = [100, 80] as const;
const DAY = 86_400_000;

const nzd = (n: number) => `$${n.toFixed(2)}`;
const levelOf = (percent: number) => LEVELS.find((l) => percent >= l) ?? 0;

// After a sync: one message for every budget that has crossed 80% or 100% of
// its limit since the last alert this month. The level only goes up within a
// month, so spending dropping back never repeats an alert. The state is saved
// after the send, so a failed send is tried again on the next sync.
export async function checkBudgetAlerts(
  db: Db,
  send: (text: string) => Promise<void>,
  now = new Date(),
): Promise<number> {
  const range = resolvePeriod("this_month", now);
  const month = range.from.toISOString().slice(0, 7);
  const [status, { rows: saved }] = await Promise.all([
    createBudgetsApi(db).budgetStatus(range),
    db.query<{
      category: string;
      alert_month: string | null;
      alert_level: number;
    }>("SELECT category, alert_month, alert_level FROM budgets"),
  ]);
  const sent = new Map(
    saved.map((r) => [r.category, r.alert_month === month ? r.alert_level : 0]),
  );
  const due = status
    .map((b) => ({ ...b, level: levelOf(b.percent) }))
    .filter((b) => b.level > (sent.get(b.category) ?? 0));
  if (due.length === 0) return 0;

  const lines = due.map((b) =>
    b.level === 100
      ? `${b.category} is over budget: ${nzd(b.spent)} of ${nzd(b.limit)} (${b.percent}%)`
      : `${b.category} has used ${b.percent}% of its budget: ${nzd(b.spent)} of ${nzd(b.limit)}`,
  );
  const asOf = new Date(range.to.getTime() - DAY).toISOString().slice(0, 10);
  await send(`Budget alert\n${lines.join("\n")}\nTransactions up to ${asOf}.`);
  for (const b of due)
    await db.query(
      "UPDATE budgets SET alert_month = $2, alert_level = $3 WHERE category = $1",
      [b.category, month, b.level],
    );
  return due.length;
}
