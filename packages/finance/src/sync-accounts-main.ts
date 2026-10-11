// One-shot: pull accounts from Akahu into the accounts table.
import { createDb, createLogger, loadConfig } from "@ops/core";
import { syncAccounts } from "./accounts.js";
import { createAkahuClient } from "./akahu.js";
import { loadFinanceConfig } from "./config.js";

const config = loadConfig();
const finance = loadFinanceConfig();
const logger = createLogger(config);
const db = createDb(config);

try {
  const count = await syncAccounts(
    db,
    createAkahuClient({
      appToken: finance.AKAHU_APP_TOKEN,
      userToken: finance.AKAHU_USER_TOKEN,
    }),
  );
  logger.info({ count }, "accounts synced");
} finally {
  await db.end();
}
