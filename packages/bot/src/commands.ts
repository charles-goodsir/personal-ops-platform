import {
  CATEGORIES,
  formatCategorySpending,
  formatSpending,
  formatSubscriptions,
  PERIODS,
  resolvePeriod,
  type FinanceApi,
  type Period,
} from "@ops/finance";
import type { Handler } from "./poller.js";

const HELP = `Commands:
/spend [period] [category]  spending, default this month
/subs [all]  recurring charges
/help

Periods: ${PERIODS.map((p) => p.replace(/_/g, " ")).join(", ")}
Categories: ${CATEGORIES.join(", ")}`;

const MAX_LENGTH = 100;

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

// Strict on purpose: a fixed list of commands, and arguments that must match
// the period names and the category list. Nothing is passed on as free text.
export function createCommandHandler(deps: {
  finance: FinanceApi;
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
      default:
        return "Unknown command. Send /help.";
    }
  };
}
