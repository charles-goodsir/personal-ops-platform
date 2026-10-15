import type { Db } from "@ops/core";
import type { AkahuClient, AkahuPending } from "./akahu.js";
import { maskDigits, maskedSql } from "./categorise.js";

// Replaces the pending charges with what Akahu lists now, in one transaction,
// so a failure leaves the old rows alone. Nothing is matched against the
// settled transactions: a charge that settles just drops out of this table and
// shows up in that one. The description is masked and cut short before it is
// stored.
export async function replacePending(
  db: Db,
  items: AkahuPending[],
  now = new Date(),
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM pending_transactions");
    for (const t of items)
      await client.query(
        `INSERT INTO pending_transactions (date, description, amount, type, fetched_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          t.date,
          maskDigits(t.description).slice(0, 300),
          t.amount,
          t.type.slice(0, 40),
          now,
        ],
      );
    await client.query("COMMIT");
    return items.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Puts my rules' categories on the pending charges, longest matching pattern
// first, as for settled transactions. There is no model here: a pending charge
// with no matching rule stays uncategorised and counts as spending.
export async function applyRulesToPending(db: Db): Promise<number> {
  const { rowCount } = await db.query(
    `WITH best AS (
       SELECT DISTINCT ON (p.id) p.id, r.category
       FROM pending_transactions p
       JOIN category_rules r
         ON position(r.pattern IN lower(${maskedSql("p.description")})) > 0
       ORDER BY p.id, length(r.pattern) DESC, r.id
     )
     UPDATE pending_transactions p SET category = best.category
     FROM best WHERE p.id = best.id`,
  );
  return rowCount ?? 0;
}

// Fetches the pending charges, replaces the table and applies the rules. Any
// failure leaves the old rows where they are, so a rate limit or a refused
// call never fails the sync.
export async function syncPending(
  db: Db,
  akahu: Pick<AkahuClient, "listPendingTransactions">,
): Promise<{ pending: number; categorised: number } | { error: unknown }> {
  try {
    const pending = await replacePending(
      db,
      await akahu.listPendingTransactions(),
    );
    return { pending, categorised: await applyRulesToPending(db) };
  } catch (error) {
    return { error };
  }
}
