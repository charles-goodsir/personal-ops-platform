// Syncs accounts then transactions from Akahu, then categorises: my rules
// first, the model for whatever is left. At startup and every 6 hours.
// `--once` runs a single sync and exits. Logs counts only, never transactions.
import { createDb, createLogger, loadConfig, trackRun } from "@ops/core";
import { syncAccounts } from "./accounts.js";
import { createAkahuClient } from "./akahu.js";
import { applyRules, categoriseWithModel } from "./categorise.js";
import { createClaudeClassifier } from "./claude.js";
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
const classify = finance.ANTHROPIC_API_KEY
  ? createClaudeClassifier({
      apiKey: finance.ANTHROPIC_API_KEY,
      model: finance.CLAUDE_BULK_MODEL,
    })
  : undefined;
if (!classify)
  logger.warn("ANTHROPIC_API_KEY not set, skipping model categorisation");

function sync() {
  return trackRun(db, logger, "finance-sync", async () => {
    const accounts = await syncAccounts(db, akahu);
    const transactions = await syncTransactions(db, akahu, {
      historyStart: finance.FINANCE_HISTORY_START,
    });
    const rules = await applyRules(db);
    const model = classify
      ? await categoriseWithModel(db, classify, logger)
      : undefined;
    logger.info(
      { accounts, ...transactions, rules, model },
      "finance sync complete",
    );
  });
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
