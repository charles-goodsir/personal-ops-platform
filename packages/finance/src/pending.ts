import type { Db } from "@ops/core";
import type { AkahuPending } from "./akahu.js";
import { maskDigits } from "./categorise.js";

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
