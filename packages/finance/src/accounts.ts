import type { Db } from "@ops/core";
import type { AkahuClient } from "./akahu.js";

// Upserts every account Akahu returns. Accounts Akahu stops returning are
// left in place (their transactions still matter) and keep their last status.
export async function syncAccounts(
  db: Db,
  akahu: Pick<AkahuClient, "listAccounts">,
) {
  const accounts = await akahu.listAccounts();
  for (const a of accounts) {
    await db.query(
      `INSERT INTO accounts (akahu_id, name, bank, type, status, currency,
         balance_current, balance_available, transactions_refreshed_at, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (akahu_id) DO UPDATE SET name = EXCLUDED.name,
         bank = EXCLUDED.bank, type = EXCLUDED.type, status = EXCLUDED.status,
         currency = EXCLUDED.currency, balance_current = EXCLUDED.balance_current,
         balance_available = EXCLUDED.balance_available,
         transactions_refreshed_at = EXCLUDED.transactions_refreshed_at,
         synced_at = now()`,
      [
        a._id,
        a.name,
        a.connection.name,
        a.type,
        a.status,
        a.balance?.currency ?? "NZD",
        a.balance?.current ?? null,
        a.balance?.available ?? null,
        a.refreshed?.transactions ?? null,
      ],
    );
  }
  return accounts.length;
}
