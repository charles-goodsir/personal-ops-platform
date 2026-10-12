// Syncs accounts then transactions from Akahu, then categorises: my rules
// first, the model for whatever is left. At startup and daily at FINANCE_SYNC_TIME (NZ).
// `--once` runs a single sync and exits. Logs counts only, never transactions.
import {
  createDb,
  createLogger,
  loadConfig,
  nextRun,
  trackRun,
  type Schedule,
} from "@ops/core";
import { syncAccounts } from "./accounts.js";
import { createAkahuClient } from "./akahu.js";
import { applyRules, categoriseWithModel } from "./categorise.js";
import { createClaudeClassifier } from "./claude.js";
import { loadFinanceConfig } from "./config.js";
import { syncTransactions } from "./transactions.js";

const config = loadConfig();
const finance = loadFinanceConfig();
const logger = createLogger(config);
const DAILY: Schedule = { time: finance.FINANCE_SYNC_TIME };
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
  let timer: NodeJS.Timeout;
  const schedule = () => {
    const at = nextRun(new Date(), DAILY);
    logger.info({ at: at.toISOString() }, "next daily finance sync");
    timer = setTimeout(
      () => void sync().then(schedule),
      at.getTime() - Date.now(),
    );
  };
  schedule();
  const shutdown = () => {
    clearTimeout(timer);
    void db.end().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
