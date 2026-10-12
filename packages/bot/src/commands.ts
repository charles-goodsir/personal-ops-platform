import {
  BUDGET_CATEGORIES,
  CATEGORIES,
  formatBudgets,
  formatCategorySpending,
  formatSpending,
  formatSubscriptions,
  PERIODS,
  resolvePeriod,
  type BudgetsApi,
  type FinanceApi,
  type Period,
} from "@ops/finance";
import type { NotesApi } from "@ops/knowledge-base";
import { JOBS, jobHealth, type JobRun } from "@ops/core";
import { ago } from "./format.js";
import type { Handler } from "./poller.js";

const HELP = `Commands:
/spend [period] [category]  spending, default this month
/subs [all]  recurring charges
/budget  spent against each monthly limit
/budget set <category> <amount>
/budget remove <category>
/notes <words>  titles and paths of matching notes
/briefing  send the daily briefing now
/status  when each background job last worked
/help

Periods: ${PERIODS.map((p) => p.replace(/_/g, " ")).join(", ")}
Categories: ${CATEGORIES.join(", ")}`;

const MAX_LENGTH = 100;
const NOTES_SHOWN = 5;

// "last month Eating out" -> the period, and what is left over as a category.
// A period can be written with spaces or underscores.
function splitPeriod(rest: string): { period: Period; category: string } {
  const text = rest.toLowerCase().replace(/_/g, " ").trim();
  for (const p of PERIODS) {
    const label = p.replace(/_/g, " ");
    if (text === label) return { period: p, category: "" };
    if (text.startsWith(`${label} `))
      return { period: p, category: text.slice(label.length).trim() };
  }
  return { period: "this_month", category: text };
}

// Whole dollars or dollars and cents, ASCII digits only: no signs, exponents,
// separators or other scripts.
const AMOUNT = /^\d{1,7}(\.\d{1,2})?$/;

// Strict on purpose: a fixed list of commands, and arguments that must match
// the period names and the category list. Nothing is passed on as free text.
export function createCommandHandler(deps: {
  finance: FinanceApi;
  budgets: BudgetsApi;
  notes: Pick<NotesApi, "searchNotes">;
  briefing: () => Promise<string>;
  jobs: () => Promise<JobRun[]>;
  now?: () => Date;
}): Handler {
  const now = deps.now ?? (() => new Date());
  return async (input) => {
    const text = input.trim();
    if (text.length > MAX_LENGTH) return "That message is too long.";
    if (!text.startsWith("/")) return "Send /help to see the commands.";
    const [head = "", ...args] = text.split(/\s+/);
    // Telegram can append the bot's name: /spend@my_bot.
    const command = head.toLowerCase().replace(/@.*$/, "");
    const rest = args.join(" ");

    switch (command) {
      case "/help":
      case "/start":
        return HELP;
      case "/subs": {
        const all = rest.toLowerCase();
        if (all !== "" && all !== "all") return "Use /subs or /subs all.";
        return formatSubscriptions(
          await deps.finance.listSubscriptions(all === "all", now()),
        );
      }
      case "/spend": {
        const { period, category } = splitPeriod(rest);
        const range = resolvePeriod(period, now());
        if (category === "")
          return formatSpending(await deps.finance.getSpending(range));
        const match = CATEGORIES.find((c) => c.toLowerCase() === category);
        if (!match) return `Unknown category.\n${HELP}`;
        return formatCategorySpending(
          await deps.finance.getCategorySpending(range, match),
        );
      }
      case "/budget": {
        const [action = "", ...words] = rest.toLowerCase().split(/\s+/);
        if (action === "") {
          const range = resolvePeriod("this_month", now());
          return formatBudgets(
            await deps.budgets.budgetStatus(range),
            range.label,
          );
        }
        if (action !== "set" && action !== "remove")
          return "Use /budget, /budget set <category> <amount> or /budget remove <category>.";
        // For set, the amount is the last word, so categories can have spaces.
        const amount = action === "set" ? words.pop() : undefined;
        const name = words.join(" ");
        const match = BUDGET_CATEGORIES.find((c) => c.toLowerCase() === name);
        if (!match) return `Budget categories: ${BUDGET_CATEGORIES.join(", ")}`;
        if (action === "remove") {
          const r = await deps.budgets.removeBudget(match);
          return r.removed
            ? `Removed the ${match} budget.`
            : `No budget set for ${match}.`;
        }
        if (amount === undefined || !AMOUNT.test(amount))
          return "Use /budget set <category> <amount>, for example /budget set groceries 600.";
        const value = Number(amount);
        if (value <= 0) return "The amount must be more than 0.";
        const r = await deps.budgets.setBudget(match, value);
        return r.replaced === null
          ? `Budget for ${r.category} set to $${r.limit.toFixed(2)} a month.`
          : `Budget for ${r.category} changed from $${r.replaced.toFixed(2)} to $${r.limit.toFixed(2)} a month.`;
      }
      case "/notes": {
        if (rest === "") return "Use /notes followed by a few words.";
        // Search returns chunks, so one note can appear several times. Only
        // titles and paths go to Telegram, never note text.
        const hits = await deps.notes.searchNotes(rest, NOTES_SHOWN * 3);
        const seen = new Set<string>();
        const lines: string[] = [];
        for (const h of hits) {
          if (seen.has(h.noteId) || lines.length === NOTES_SHOWN) continue;
          seen.add(h.noteId);
          lines.push(`${lines.length + 1}. ${h.title} (${h.path})`);
        }
        return lines.length
          ? `Notes matching "${rest}":\n${lines.join("\n")}`
          : "No matching notes.";
      }
      case "/briefing":
        return deps.briefing();
      case "/status": {
        const runs = await deps.jobs();
        return JOBS.map((job) => {
          const h = jobHealth(
            job,
            runs.find((r) => r.job === job),
            now(),
          );
          switch (h.state) {
            case "never":
              return h.failures
                ? `${job}: failing (${h.failures} in a row), never succeeded`
                : `${job}: no run recorded yet`;
            case "ok":
              return `${job}: ok, ${ago(h.ageMs)} ago`;
            case "failing":
              return `${job}: failing (${h.failures} in a row), last ok ${ago(h.ageMs)} ago`;
            case "late":
              return `${job}: LATE, last ok ${ago(h.ageMs)} ago`;
          }
        }).join("\n");
      }
      default:
        return "Unknown command. Send /help.";
    }
  };
}
