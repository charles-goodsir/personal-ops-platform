import type { Db } from "@ops/core";
import type { AkahuClient } from "./akahu.js";

const DAY = 24 * 60 * 60 * 1000;

// Akahu has no webhooks for personal apps, and about 0.1% of heavily edited
// transactions come back with a new id. So every sync re-reads a window and
// makes the table match it: upsert what's there, delete what vanished.
// Nothing before historyStart is fetched or kept.
export async function syncTransactions(
  db: Db,
  akahu: Pick<AkahuClient, "listTransactions">,
  opts: { historyStart: Date; now?: Date; windowDays?: number },
) {
  const now = opts.now ?? new Date();
  const { historyStart } = opts;
  // Any account with no transactions yet (first run, or one just connected
  // in Akahu) needs the full history, not just the window.
  // ponytail: an account that genuinely has no transactions triggers a full
  // re-read every sync; cheap at this size, per-account fetches if it grows.
  const { rows } = await db.query<{ missing: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM accounts a WHERE NOT EXISTS
       (SELECT 1 FROM transactions t WHERE t.account_id = a.akahu_id)) AS missing`,
  );
  const windowStart = new Date(now.getTime() - (opts.windowDays ?? 14) * DAY);
  const backfill = rows[0]?.missing ?? true;
  const start =
    backfill || windowStart < historyStart ? historyStart : windowStart;
  const days = Math.round((now.getTime() - start.getTime()) / DAY);
  // Akahu's start is exclusive; 1ms earlier includes a transaction stamped
  // exactly at historyStart.
  const fetched = (
    await akahu.listTransactions(new Date(start.getTime() - 1), now)
  ).filter((t) => new Date(t.date) >= historyStart);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Inserts come back with xmax = 0; updates are counted only when a
    // value Akahu owns actually changed.
    const { rows: upserted } = await client.query<{ inserted: boolean }>(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount,
         type, merchant, akahu_category, akahu_group, synced_at)
       SELECT * , now() FROM unnest($1::text[], $2::text[], $3::timestamptz[],
         $4::text[], $5::numeric[], $6::text[], $7::text[], $8::text[], $9::text[])
       ON CONFLICT (akahu_id) DO UPDATE SET account_id = EXCLUDED.account_id,
         date = EXCLUDED.date, description = EXCLUDED.description,
         amount = EXCLUDED.amount, type = EXCLUDED.type, merchant = EXCLUDED.merchant,
         akahu_category = EXCLUDED.akahu_category, akahu_group = EXCLUDED.akahu_group,
         synced_at = now()
       WHERE (transactions.account_id, transactions.date, transactions.description,
              transactions.amount, transactions.type, transactions.merchant,
              transactions.akahu_category, transactions.akahu_group)
         IS DISTINCT FROM
             (EXCLUDED.account_id, EXCLUDED.date, EXCLUDED.description,
              EXCLUDED.amount, EXCLUDED.type, EXCLUDED.merchant,
              EXCLUDED.akahu_category, EXCLUDED.akahu_group)
       RETURNING (xmax = 0) AS inserted`,
      [
        fetched.map((t) => t._id),
        fetched.map((t) => t._account),
        fetched.map((t) => t.date),
        fetched.map((t) => t.description),
        fetched.map((t) => t.amount),
        fetched.map((t) => t.type),
        fetched.map((t) => t.merchant?.name ?? null),
        fetched.map((t) => t.category?.name ?? null),
        fetched.map((t) => t.category?.groups?.personal_finance?.name ?? null),
      ],
    );
    // Only inside the window, and only for accounts that are still active:
    // a disconnected account returns nothing, and that isn't a deletion.
    const { rowCount: removed } = await client.query(
      `DELETE FROM transactions
       WHERE date > $1 AND akahu_id <> ALL($2::text[])
         AND account_id IN (SELECT akahu_id FROM accounts WHERE status = 'ACTIVE')`,
      [start, fetched.map((t) => t._id)],
    );
    // Keeps the table to the configured history, including after the start
    // date moves forward. Akahu still has older data if it moves back.
    const { rowCount: pruned } = await client.query(
      "DELETE FROM transactions WHERE date < $1",
      [historyStart],
    );
    await client.query("COMMIT");
    const added = upserted.filter((r) => r.inserted).length;
    return {
      fetched: fetched.length,
      added,
      updated: upserted.length - added,
      removed: removed ?? 0,
      pruned: pruned ?? 0,
      days,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
