import type { Db } from "@ops/core";
import { createBudgetsApi, formatBudgets, resolvePeriod } from "@ops/finance";
import type { Section } from "./runner.js";

// This month's spending against each budget, worded as /budget words it.
// Nothing to say, and no heading, until a budget is set.
export function budgetsSection(db: Db, now = () => new Date()): Section {
  return {
    name: "Budgets",
    async build() {
      const status = await createBudgetsApi(db).budgetStatus(
        resolvePeriod("this_month", now()),
      );
      return status.length ? formatBudgets(status, "this month") : null;
    },
  };
}
