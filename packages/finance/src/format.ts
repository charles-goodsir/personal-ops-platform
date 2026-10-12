import type { Recurring } from "./insights.js";
import type { CategorySpending, Spending } from "./read.js";

const nzd = (n: number) => `$${n.toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

// Plain-text answers shared by the MCP tools and the Telegram bot, so both
// say the same thing about the same numbers.
export function formatCategorySpending(c: CategorySpending): string {
  const payees = c.topPayees
    .map((p) => `  ${p.payee}: ${nzd(p.spent)} (${p.count})`)
    .join("\n");
  return (
    `${c.category}, ${c.range.label}: ${nzd(c.spent)} across ${c.count} transactions.` +
    (payees ? `\nTop payees:\n${payees}` : "")
  );
}

export function formatSpending(s: Spending): string {
  const lines = s.byCategory.map(
    (c) => `  ${c.category}: ${nzd(c.spent)} (${c.count})`,
  );
  if (s.uncategorised) lines.push(`  Uncategorised: ${nzd(s.uncategorised)}`);
  return `Spending ${s.range.label}: ${nzd(s.total)}\n${lines.join("\n")}\nIncome: ${nzd(s.income)}\nInvested: ${nzd(s.invested)}`;
}

export function formatSubscriptions(subs: Recurring[]): string {
  if (subs.length === 0) return "No recurring charges found.";
  const monthly = subs
    .filter((r) => r.active)
    .reduce((t, r) => t + r.monthlyCost, 0);
  return (
    subs
      .map(
        (r) =>
          `${r.payee} | ${r.cadence} | ${nzd(r.typicalAmount)} (~${nzd(r.monthlyCost)}/month) | ${r.category ?? "uncategorised"} | ` +
          (r.active
            ? `next ~${day(r.nextExpected)}`
            : `inactive since ${day(r.lastDate)}`),
      )
      .join("\n") + `\nActive total: ~${nzd(monthly)}/month`
  );
}
