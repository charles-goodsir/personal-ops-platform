import type { Db } from "@ops/core";
import type { AkahuClient } from "./akahu.js";

const DAY = 24 * 60 * 60 * 1000;

// Akahu has no webhooks for personal apps, and about 0.1% of heavily edited
// transactions come back with a new id. So every sync re-reads a window and
// makes the table match it: upsert what's there, delete what vanished.
export async function syncTransactions(
  db: Db,
  akahu: Pick<AkahuClient, "listTransactions">,
  opts: { now?: Date; windowDays?: number; backfillDays?: number } = {},
) {
  const now = opts.now ?? new Date();
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM transactions",
  );
  // First run backfills history (Akahu caps personal apps at about 2 years).
  const days =
    Number(rows[0]?.n) === 0
      ? (opts.backfillDays ?? 730)
      : (opts.windowDays ?? 14);
  const start = new Date(now.getTime() - days * DAY);
  const fetched = await akahu.listTransactions(start, now);

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
    await client.query("COMMIT");
    const added = upserted.filter((r) => r.inserted).length;
    return {
      fetched: fetched.length,
      added,
      updated: upserted.length - added,
      removed: removed ?? 0,
      days,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
