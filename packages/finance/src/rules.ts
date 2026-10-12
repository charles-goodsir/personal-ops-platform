import type { Db } from "@ops/core";
import { CATEGORIES, type Category } from "./categories.js";
import { applyRules, maskedSql } from "./categorise.js";

export type Rule = {
  pattern: string;
  category: string;
  matches: number;
  createdAt: Date;
};

// Same normalisation the table's CHECK enforces, so errors are readable.
function normalise(pattern: string): string {
  const p = pattern.trim().toLowerCase();
  if (p.length < 2 || p.length > 100) {
    throw new Error("pattern must be 2 to 100 characters");
  }
  // A newline could forge a line when the rules are listed.
  if (/\p{Cc}/u.test(p))
    throw new Error("pattern can't contain control characters");
  return p;
}

const MIN_FOR_BREADTH = 20;
const MAX_SHARE = 0.25;

const MATCHES = `(SELECT count(*) FROM transactions t
  WHERE position(r.pattern IN lower(${maskedSql("t.description || ' ' || coalesce(t.merchant, '')")})) > 0)::int`;

// Editing rules from chat: the write side of categorisation. Every change
// re-applies the rules at once, so the reply shows what it actually did.
export function createRulesApi(db: Db) {
  return {
    async addRule(pattern: string, category: Category) {
      // Checked here too: the MCP schema isn't the only possible caller.
      if (!CATEGORIES.includes(category)) {
        throw new Error(`unknown category: ${category}`);
      }
      const p = normalise(pattern);
      // One rule can't recategorise most of the transactions at once, whether it
      // is a mistake or text steering Claude. It only applies once there is enough
      // data for a share to mean something.
      const { rows: breadth } = await db.query<{
        matches: number;
        total: number;
      }>(
        `SELECT count(*) FILTER (WHERE position($1 IN lower(${maskedSql("t.description || ' ' || coalesce(t.merchant, '')")})) > 0)::int AS matches,
                count(*)::int AS total
         FROM transactions t`,
        [p],
      );
      const { matches = 0, total = 0 } = breadth[0] ?? {};
      if (total >= MIN_FOR_BREADTH && matches > total * MAX_SHARE) {
        throw new Error(
          `pattern matches ${matches} of ${total} transactions, which is too broad: use a longer pattern`,
        );
      }
      const { rows } = await db.query<{ replaced: string | null }>(
        `WITH old AS (SELECT category FROM category_rules WHERE pattern = $1)
         INSERT INTO category_rules (pattern, category) VALUES ($1, $2)
         ON CONFLICT (pattern) DO UPDATE SET category = EXCLUDED.category
         RETURNING (SELECT category FROM old) AS replaced`,
        [p, category],
      );
      const { applied, cleared } = await applyRules(db);
      const { rows: count } = await db.query<{ matches: number }>(
        `SELECT ${MATCHES} AS matches FROM category_rules r WHERE r.pattern = $1`,
        [p],
      );
      return {
        pattern: p,
        category,
        replaced: rows[0]?.replaced ?? null,
        matches: count[0]?.matches ?? 0,
        changed: applied + cleared,
      };
    },

    async listRules(): Promise<Rule[]> {
      const { rows } = await db.query<Rule>(
        `SELECT r.pattern, r.category, ${MATCHES} AS matches, r.created_at AS "createdAt"
         FROM category_rules r ORDER BY r.pattern`,
      );
      return rows;
    },

    // Transactions the rule had set go back to uncategorised; the model
    // picks them up on the next finance sync.
    async removeRule(pattern: string) {
      const p = normalise(pattern);
      const { rowCount } = await db.query(
        "DELETE FROM category_rules WHERE pattern = $1",
        [p],
      );
      if (!rowCount) return { pattern: p, removed: false, uncategorised: 0 };
      const { applied, cleared } = await applyRules(db);
      return {
        pattern: p,
        removed: true,
        uncategorised: cleared,
        recategorised: applied,
      };
    },
  };
}

export type RulesApi = ReturnType<typeof createRulesApi>;
