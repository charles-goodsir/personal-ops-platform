import type { Db, Logger } from "@ops/core";
import type { Category } from "./categories.js";

// What the model sees for one transaction. No ids from Akahu, no account
// numbers: just a batch-local number and the masked text.
export type ClassifyItem = {
  id: number;
  description: string;
  amount: number;
  type: string;
  merchant: string | null;
  akahuCategory: string | null;
};

export type Classifier = (
  items: ClassifyItem[],
) => Promise<{ id: number; category: Category }[]>;

// Runs of 6+ digits in descriptions are card fragments, references and
// account-like numbers, and a bank's own card mask ("****** 7997") still ends
// in real card digits. None of them leave the box.
// Card numbers and NZ account numbers are often written in groups, so the groups
// are masked as a whole before the plain runs. The patterns use only syntax that
// JavaScript and Postgres share (no \b: it means backspace in Postgres), so the
// same list masks text in code and, through maskedSql, inside a query.
const MASKS: [pattern: string, replacement: string][] = [
  ["\\*{2,}\\s*\\d{1,4}", "[card]"],
  ["\\d{4}[ -]\\d{4}[ -]\\d{4}[ -]\\d{1,4}", "[number]"], // 4-4-4-4
  ["\\d{4}[ -]\\d{6}[ -]\\d{5}", "[number]"], // 4-6-5
  ["\\d{2}-\\d{4}-\\d{7}-\\d{2,3}", "[number]"], // NZ account
  ["\\d{6,}", "[number]"],
];

export const maskDigits = (s: string) =>
  MASKS.reduce((out, [p, r]) => out.replace(new RegExp(p, "g"), r), s);

// The same masking as SQL, for a column or expression. Searching and rule
// matching work on this, so a caller can't find a hidden number by asking
// whether it is there. The patterns are constants, never input.
export const maskedSql = (expr: string) =>
  MASKS.reduce(
    (sql, [p, r]) => `regexp_replace(${sql}, '${p}', '${r}', 'g')`,
    expr,
  );

// Applies my rules to every transaction, longest matching pattern first, and
// clears rule categories whose rule has gone so the model can redo them.
export async function applyRules(db: Db) {
  const { rowCount: applied } = await db.query(
    `WITH best AS (
       SELECT DISTINCT ON (t.akahu_id) t.akahu_id, r.category
       FROM transactions t
       JOIN category_rules r
         ON position(r.pattern IN lower(${maskedSql("t.description || ' ' || coalesce(t.merchant, '')")})) > 0
       ORDER BY t.akahu_id, length(r.pattern) DESC, r.id
     )
     UPDATE transactions t
     SET category = best.category, category_source = 'rule', categorised_at = now()
     FROM best
     WHERE t.akahu_id = best.akahu_id
       AND (t.category, t.category_source) IS DISTINCT FROM (best.category, 'rule')`,
  );
  const { rowCount: cleared } = await db.query(
    `UPDATE transactions t
     SET category = NULL, category_source = NULL, categorised_at = NULL
     WHERE t.category_source = 'rule' AND NOT EXISTS (
       SELECT 1 FROM category_rules r
       WHERE position(r.pattern IN lower(t.description || ' ' || coalesce(t.merchant, ''))) > 0)`,
  );
  return { applied: applied ?? 0, cleared: cleared ?? 0 };
}

// Sends uncategorised transactions to the model in batches. A failed batch
// stops the run; those rows stay uncategorised and are retried next time.
export async function categoriseWithModel(
  db: Db,
  classify: Classifier,
  logger: Logger,
  opts: { batchSize?: number } = {},
) {
  const batchSize = opts.batchSize ?? 50;
  const { rows } = await db.query<{
    akahu_id: string;
    description: string;
    amount: string;
    type: string;
    merchant: string | null;
    akahu_category: string | null;
  }>(
    `SELECT akahu_id, description, amount, type, merchant, akahu_category
     FROM transactions WHERE category IS NULL ORDER BY date DESC`,
  );
  let categorised = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const items = batch.map((r, n) => ({
      id: n,
      description: maskDigits(r.description),
      amount: Number(r.amount),
      type: r.type,
      merchant: r.merchant,
      akahuCategory: r.akahu_category,
    }));
    let results: Awaited<ReturnType<Classifier>>;
    try {
      results = await classify(items);
    } catch (err) {
      logger.error({ err, batchStart: i }, "categorisation batch failed");
      break;
    }
    // Ignore ids outside the batch; missing ones stay null for next time.
    const updates = results.filter((r) => batch[r.id]);
    await db.query(
      `UPDATE transactions t SET category = u.category, category_source = 'model',
         categorised_at = now()
       FROM unnest($1::text[], $2::text[]) AS u(akahu_id, category)
       WHERE t.akahu_id = u.akahu_id AND t.category IS NULL`,
      [
        updates.map((r) => batch[r.id]?.akahu_id),
        updates.map((r) => r.category),
      ],
    );
    categorised += updates.length;
  }
  return { pending: rows.length, categorised };
}
