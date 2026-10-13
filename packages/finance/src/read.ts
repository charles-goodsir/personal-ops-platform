import type { Db } from "@ops/core";
import { maskDigits, maskedSql } from "./categorise.js";
import { detectRecurring, loadRecentTxs, type Recurring } from "./insights.js";
import type { Range } from "./periods.js";

// Money out that isn't spending: moving money between my own accounts, and
// putting it into investments.
const NOT_SPENDING = ["Transfers", "Investments"];

export type Spending = {
  range: Range;
  total: number;
  income: number;
  invested: number;
  byCategory: { category: string; spent: number; count: number }[];
  uncategorised: number;
};

export type CategorySpending = {
  range: Range;
  category: string;
  spent: number;
  count: number;
  topPayees: { payee: string; spent: number; count: number }[];
};

export type TxRow = {
  date: Date;
  description: string; // digits masked, as for the categoriser
  amount: number;
  category: string | null;
  account: string;
};

export type TxFilters = {
  range?: Range;
  category?: string;
  search?: string;
  minAmount?: number; // absolute value, either direction
  maxAmount?: number;
  limit: number;
};

const MAX_DESCRIPTION = 300;

const money = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

// The read side of finance: what the MCP tools and the weekly summary call.
export function createFinanceApi(db: Db) {
  return {
    async getSpending(range: Range): Promise<Spending> {
      const { rows } = await db.query<{
        category: string | null;
        spent: string;
        count: number;
      }>(
        `SELECT category, -sum(amount) AS spent, count(*)::int AS count
         FROM transactions
         WHERE date >= $1 AND date < $2 AND amount < 0
           AND coalesce(category, '') <> ALL($3::text[])
         GROUP BY category ORDER BY spent DESC`,
        [range.from, range.to, NOT_SPENDING],
      );
      const { rows: other } = await db.query<{
        income: string;
        invested: string;
      }>(
        `SELECT coalesce(sum(amount) FILTER (WHERE category = 'Income' AND amount > 0), 0) AS income,
                coalesce(-sum(amount) FILTER (WHERE category = 'Investments' AND amount < 0), 0) AS invested
         FROM transactions WHERE date >= $1 AND date < $2`,
        [range.from, range.to],
      );
      const byCategory = rows
        .filter((r) => r.category !== null)
        .map((r) => ({
          category: r.category as string,
          spent: money(r.spent),
          count: r.count,
        }));
      return {
        range,
        total: money(rows.reduce((s, r) => s + Number(r.spent), 0)),
        income: money(other[0]?.income),
        invested: money(other[0]?.invested),
        byCategory,
        uncategorised: money(rows.find((r) => r.category === null)?.spent),
      };
    },

    async getCategorySpending(
      range: Range,
      category: string,
    ): Promise<CategorySpending> {
      const { rows } = await db.query<{
        payee: string;
        spent: string;
        count: number;
      }>(
        `SELECT coalesce(merchant, description) AS payee, -sum(amount) AS spent, count(*)::int AS count
         FROM transactions
         WHERE date >= $1 AND date < $2 AND amount < 0 AND category = $3
         GROUP BY 1 ORDER BY spent DESC`,
        [range.from, range.to, category],
      );
      return {
        range,
        category,
        spent: money(rows.reduce((s, r) => s + Number(r.spent), 0)),
        count: rows.reduce((s, r) => s + r.count, 0),
        topPayees: rows.slice(0, 5).map((r) => ({
          payee: maskDigits(r.payee),
          spent: money(r.spent),
          count: r.count,
        })),
      };
    },

    // When Akahu last pulled from the bank, for the account that is furthest
    // behind. Null until a sync has stored one.
    async getBankFreshness(): Promise<Date | null> {
      const { rows } = await db.query<{ at: Date | null }>(
        "SELECT min(transactions_refreshed_at) AS at FROM accounts WHERE status = 'ACTIVE'",
      );
      return rows[0]?.at ?? null;
    },

    async listSubscriptions(
      includeInactive: boolean,
      now = new Date(),
    ): Promise<Recurring[]> {
      const all = detectRecurring(await loadRecentTxs(db, now), now);
      return includeInactive ? all : all.filter((r) => r.active);
    },

    // Search is plain text (position(), not LIKE), so % and _ match literally. It
    // looks at the masked text, so a hidden number can't be found by searching.
    async getTransactions(f: TxFilters): Promise<TxRow[]> {
      const { rows } = await db.query<{
        date: Date;
        description: string;
        amount: string;
        category: string | null;
        account: string;
      }>(
        `SELECT t.date, t.description, t.amount, t.category, a.name AS account
         FROM transactions t JOIN accounts a ON a.akahu_id = t.account_id
         WHERE ($1::timestamptz IS NULL OR t.date >= $1)
           AND ($2::timestamptz IS NULL OR t.date < $2)
           AND ($3::text IS NULL OR t.category = $3)
           AND ($4::text IS NULL OR position(lower($4) IN lower(${maskedSql("t.description || ' ' || coalesce(t.merchant, '')")})) > 0)
           AND ($5::numeric IS NULL OR abs(t.amount) >= $5)
           AND ($6::numeric IS NULL OR abs(t.amount) <= $6)
         ORDER BY t.date DESC, t.akahu_id
         LIMIT $7`,
        [
          f.range?.from ?? null,
          f.range?.to ?? null,
          f.category ?? null,
          f.search ?? null,
          f.minAmount ?? null,
          f.maxAmount ?? null,
          f.limit,
        ],
      );
      return rows.map((r) => ({
        ...r,
        // Capped: a bank's description is short, and a huge one would flood the
        // output.
        description: maskDigits(r.description).slice(0, MAX_DESCRIPTION),
        amount: money(r.amount),
      }));
    },
  };
}

export type FinanceApi = ReturnType<typeof createFinanceApi>;
