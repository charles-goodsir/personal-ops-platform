// Syncs accounts then transactions from Akahu, at startup and every 6 hours.
// `--once` runs a single sync and exits. Logs counts only, never transactions.
import { createDb, createLogger, loadConfig } from "@ops/core";
import { syncAccounts } from "./accounts.js";
import { createAkahuClient } from "./akahu.js";
import { loadFinanceConfig } from "./config.js";
import { syncTransactions } from "./transactions.js";

const SYNC_MS = 6 * 60 * 60 * 1000;

const config = loadConfig();
const finance = loadFinanceConfig();
const logger = createLogger(config);
const db = createDb(config);
const akahu = createAkahuClient({
  appToken: finance.AKAHU_APP_TOKEN,
  userToken: finance.AKAHU_USER_TOKEN,
});

async function sync() {
  try {
    const accounts = await syncAccounts(db, akahu);
    const transactions = await syncTransactions(db, akahu);
    logger.info({ accounts, ...transactions }, "finance sync complete");
    return true;
  } catch (err) {
    logger.error({ err }, "finance sync failed");
    return false;
  }
}

if (process.argv.includes("--once")) {
  const ok = await sync();
  await db.end();
  process.exitCode = ok ? 0 : 1;
} else {
  await sync();
  const timer = setInterval(() => void sync(), SYNC_MS);
  const shutdown = () => {
    clearInterval(timer);
    void db.end().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
