import type { Goal } from "./goals.js";
import { fortnightWindow, type BigCharge, type Plan } from "./payday-plan.js";
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

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function formatGoals(goals: Goal[]): string {
  if (goals.length === 0)
    return "No goals yet. Use /goal add <name> <target> [date].";
  const lines = goals.map((g) => {
    const percent = Math.round((g.saved / g.target) * 100);
    return `  ${g.name}: ${nzd(g.saved)} of ${nzd(g.target)} (${percent}%)${g.due ? `, due ${g.due}` : ""}, weight ${g.weight}`;
  });
  return `Goals:\n${lines.join("\n")}`;
}

// One charge is worth a line when it is a large part of the spend, since a
// single wrong category can move the whole total.
const BIG_SHARE = 0.3;
const BIG_MIN_CENTS = 10_000;

function bigLine(spent: number, big: BigCharge | null): string[] {
  if (!big) return [];
  const cents = Math.round(big.amount * 100);
  if (cents < BIG_MIN_CENTS || cents < spent * BIG_SHARE) return [];
  const percent = Math.round((cents / spent) * 100);
  return [
    `One charge: ${big.category} ${usd(cents)}, ${percent}% of the spend`,
  ];
}

// The payday message: what I spent against the target, and where the pay goes.
// `payday` is the date the pay landed, "YYYY-MM-DD". `big` is the largest
// single charge in the fortnight, if known.
export function formatPlan(
  plan: Plan,
  payday: string,
  big: BigCharge | null = null,
): string {
  if (!plan.ready)
    return `Payday plan: still to set: ${plan.missing.join(", ")}. Use /payday set <item> <amount>.`;
  const { from, to } = fortnightWindow(payday);
  const standing =
    plan.standing === "under"
      ? `${usd(plan.surplus)} under`
      : plan.standing === "over"
        ? `${usd(plan.over)} over`
        : "on target";
  const lines = [
    `Payday plan for ${payday}`,
    `Spent ${from} to ${to}: ${usd(plan.spent)} of a ${usd(plan.target)} target (${standing})`,
    ...bigLine(plan.spent, big),
    `Rent and bills: ${usd(plan.rent)}`,
    `Savings: ${usd(plan.savings)}${plan.savings > plan.base.savings ? ` (usual ${usd(plan.base.savings)} plus ${usd(plan.savings - plan.base.savings)})` : ""}`,
    `Investments: ${usd(plan.invest)}${plan.invest > plan.base.invest ? ` (usual ${usd(plan.base.invest)} plus ${usd(plan.invest - plan.base.invest)})` : ""}`,
  ];
  for (const g of plan.goals)
    if (g.cents > 0)
      lines.push(
        `  ${g.name}: ${usd(g.cents)}${g.reaches ? " (reaches its target)" : ""}`,
      );
  if (plan.unallocated > 0)
    lines.push(`Not going to a goal: ${usd(plan.unallocated)}`);
  if (plan.shortfall > 0)
    lines.push(
      `The pay is ${usd(plan.shortfall)} short of rent and the usual savings and investments.`,
    );
  return lines.join("\n");
}
