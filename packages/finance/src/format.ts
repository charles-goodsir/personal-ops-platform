import type { BudgetStatus } from "./budgets.js";
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

export function formatBudgets(rows: BudgetStatus[], label: string): string {
  if (rows.length === 0)
    return "No budgets set. Use /budget set <category> <amount>.";
  const lines = rows.map(
    (b) =>
      `  ${b.category}: ${nzd(b.spent)} of ${nzd(b.limit)} (${b.percent}%)${b.percent >= 100 ? " OVER" : ""}`,
  );
  return `Budgets ${label}:\n${lines.join("\n")}`;
}

// "Bank data refreshed Tue 13 Oct, 11:17 (23h ago)", in New Zealand time.
export function formatFreshness(at: Date | null, now: Date): string {
  if (!at) return "Bank data: refresh time unknown";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const hours = Math.max(
    0,
    Math.round((now.getTime() - at.getTime()) / 3_600_000),
  );
  const age = hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
  return `Bank data refreshed ${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} (${age})`;
}
