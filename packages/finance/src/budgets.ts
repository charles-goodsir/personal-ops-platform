import type { Db } from "@ops/core";
import { CATEGORIES, type Category } from "./categories.js";
import type { Range } from "./periods.js";
import { createFinanceApi } from "./read.js";

// Categories that spending reports leave out, so a limit on them would never
// show anything. Income is money in, Transfers and Investments are not spending.
const NOT_BUDGETABLE: readonly string[] = [
  "Income",
  "Transfers",
  "Investments",
];
export const BUDGET_CATEGORIES = CATEGORIES.filter(
  (c) => !NOT_BUDGETABLE.includes(c),
);

const MAX_LIMIT = 1_000_000;

export type Budget = { category: string; limit: number };
export type BudgetStatus = Budget & {
  spent: number;
  percent: number; // whole number, can pass 100
};

// Budgets from chat: the only writer is the bot, and a limit is just a number.
export function createBudgetsApi(db: Db) {
  const finance = createFinanceApi(db);
  return {
    async setBudget(category: Category, amount: number) {
      // Checked here too: the bot's own parsing isn't the only possible caller.
      if (!BUDGET_CATEGORIES.includes(category)) {
        throw new Error(`can't set a budget for: ${category}`);
      }
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_LIMIT) {
        throw new Error(`amount must be more than 0 and at most ${MAX_LIMIT}`);
      }
      const limit = Math.round(amount * 100) / 100;
      const { rows } = await db.query<{ replaced: string | null }>(
        `WITH old AS (SELECT monthly_limit FROM budgets WHERE category = $1)
         INSERT INTO budgets (category, monthly_limit) VALUES ($1, $2)
         ON CONFLICT (category) DO UPDATE
           SET monthly_limit = EXCLUDED.monthly_limit, updated_at = now()
         RETURNING (SELECT monthly_limit FROM old) AS replaced`,
        [category, limit],
      );
      const replaced = rows[0]?.replaced;
      return {
        category,
        limit,
        replaced: replaced == null ? null : Number(replaced),
      };
    },

    async removeBudget(category: Category) {
      const { rowCount } = await db.query(
        "DELETE FROM budgets WHERE category = $1",
        [category],
      );
      return { category, removed: Boolean(rowCount) };
    },

    async listBudgets(): Promise<Budget[]> {
      const { rows } = await db.query<{ category: string; limit: string }>(
        `SELECT category, monthly_limit AS "limit" FROM budgets ORDER BY category`,
      );
      return rows.map((r) => ({
        category: r.category,
        limit: Number(r.limit),
      }));
    },

    // Spent against limit for one range, using the same totals as /spend.
    async budgetStatus(range: Range): Promise<BudgetStatus[]> {
      const [budgets, spending] = await Promise.all([
        this.listBudgets(),
        finance.getSpending(range),
      ]);
      const spent = new Map(
        spending.byCategory.map((c) => [c.category, c.spent]),
      );
      return budgets.map((b) => {
        const s = spent.get(b.category) ?? 0;
        return { ...b, spent: s, percent: Math.round((s / b.limit) * 100) };
      });
    },
  };
}

export type BudgetsApi = ReturnType<typeof createBudgetsApi>;
