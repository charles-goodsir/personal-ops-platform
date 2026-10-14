import {
  computePlan,
  formatGoals,
  formatPlan,
  lastPayday,
  normaliseName,
  SETTING_ITEMS,
  type GoalsApi,
  type PaydaySettingsApi,
  type SettingItem,
} from "@ops/finance";

// Whole dollars or dollars and cents, ASCII digits only: no signs, exponents,
// separators or other scripts.
const AMOUNT = /^\d{1,7}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEIGHT = /^([1-9]|10)$/;

const PAYDAY_USAGE =
  "Use /payday, or /payday set <pay|rent|savings|invest|spending> <amount>, or /payday set payday <YYYY-MM-DD>. Several pairs can go in one message.";
const GOAL_USAGE =
  "Use /goal, /goal add <name> <target> [YYYY-MM-DD], /goal saved <name> <amount>, /goal weight <name> <1-10> or /goal remove <name>.";
const LABEL: Record<SettingItem, string> = {
  pay: "Pay",
  rent: "Rent and bills",
  savings: "Savings",
  invest: "Investments",
  spending: "Spending target",
};

// The payday settings and the goals from chat. Strict on purpose: an amount is
// plain digits, a date is YYYY-MM-DD, a name goes through the same check as the
// API, and nothing else is passed on.
export function createPaydayCommands(deps: {
  payday: PaydaySettingsApi;
  goals: GoalsApi;
  spent: (payday: string) => Promise<number>;
}) {
  // The API's name message is one of its own fixed sentences, so it is safe to show.
  const name = (words: string[]): [string, null] | [null, string] => {
    try {
      return [normaliseName(words.join(" ")), null];
    } catch (err) {
      return [null, (err as Error).message];
    }
  };

  return {
    // `today` is the NZ date, "YYYY-MM-DD".
    async payday(args: string[], today: string): Promise<string> {
      if (args.length === 0) {
        const settings = await deps.payday.getSettings();
        const goals = await deps.goals.listGoals();
        if (settings.payday === null)
          return "Set a payday first, for example /payday set payday 2026-10-13.";
        const last = lastPayday(settings.payday, today);
        if (last === null)
          return `The first payday, ${settings.payday}, has not come yet.`;
        const missing = computePlan(settings, 0, goals);
        if (!missing.ready) return formatPlan(missing, last);
        return formatPlan(
          computePlan(settings, await deps.spent(last), goals),
          last,
        );
      }
      // One or more <item> <value> pairs, so a whole setup can go in one
      // message. Every pair is checked before anything is saved.
      const [action, ...pairs] = args;
      if (
        action?.toLowerCase() !== "set" ||
        pairs.length === 0 ||
        pairs.length % 2 !== 0
      )
        return PAYDAY_USAGE;
      const sets: [string, string][] = [];
      for (let i = 0; i < pairs.length; i += 2) {
        const key = (pairs[i] as string).toLowerCase();
        const value = pairs[i + 1] as string;
        if (key === "payday") {
          if (!DATE.test(value)) return PAYDAY_USAGE;
        } else if (!SETTING_ITEMS.includes(key as SettingItem))
          return PAYDAY_USAGE;
        else if (!AMOUNT.test(value) || Number(value) <= 0)
          return "The amount must be more than 0, in digits, with at most two decimals.";
        sets.push([key, value]);
      }
      const replies: string[] = [];
      for (const [key, value] of sets) {
        if (key === "payday") {
          try {
            const r = await deps.payday.setPayday(value);
            replies.push(
              `Payday set to ${r.payday}. Paydays fall every 14 days from it.`,
            );
          } catch (err) {
            // A date that is not real: the API's own message, and any
            // earlier pairs in this message are already saved.
            replies.push((err as Error).message);
          }
        } else {
          const r = await deps.payday.setAmount(
            key as SettingItem,
            Number(value),
          );
          replies.push(`${LABEL[r.item]} set to $${r.amount.toFixed(2)}.`);
        }
      }
      return replies.join("\n");
    },

    async goal(args: string[]): Promise<string> {
      if (args.length === 0) return formatGoals(await deps.goals.listGoals());
      const [action = "", ...rest] = args;
      switch (action.toLowerCase()) {
        case "add": {
          // The last word may be a date, then the target, and the rest is the name.
          const due = DATE.test(rest.at(-1) ?? "") ? rest.pop() : undefined;
          const target = rest.pop();
          if (
            target === undefined ||
            !AMOUNT.test(target) ||
            Number(target) <= 0
          )
            return GOAL_USAGE;
          const [n, bad] = name(rest);
          if (n === null) return bad;
          try {
            const g = await deps.goals.addGoal({
              name: n,
              target: Number(target),
              due,
            });
            return `Added goal ${g.name}: $${g.target.toFixed(2)}${g.due ? `, due ${g.due}` : ""}.`;
          } catch (err) {
            const message = (err as Error).message;
            if (/^(a goal called|date )/.test(message)) return message;
            throw err;
          }
        }
        case "saved": {
          const amount = rest.pop();
          if (amount === undefined || !AMOUNT.test(amount)) return GOAL_USAGE;
          const [n, bad] = name(rest);
          if (n === null) return bad;
          const g = await deps.goals.setSaved(n, Number(amount));
          return g
            ? `${g.name}: $${g.saved.toFixed(2)} saved of $${g.target.toFixed(2)}.`
            : `No goal called ${n}.`;
        }
        case "weight": {
          const weight = rest.pop();
          if (weight === undefined || !WEIGHT.test(weight)) return GOAL_USAGE;
          const [n, bad] = name(rest);
          if (n === null) return bad;
          const g = await deps.goals.setWeight(n, Number(weight));
          return g ? `${g.name}: weight ${g.weight}.` : `No goal called ${n}.`;
        }
        case "remove": {
          const [n, bad] = name(rest);
          if (n === null) return bad;
          return (await deps.goals.removeGoal(n))
            ? `Removed the goal ${n}.`
            : `No goal called ${n}.`;
        }
        default:
          return GOAL_USAGE;
      }
    },
  };
}
