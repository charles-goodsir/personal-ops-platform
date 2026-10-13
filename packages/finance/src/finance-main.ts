// Syncs accounts then transactions from Akahu, then categorises: my rules
// first, the model for whatever is left. At startup, daily at FINANCE_SYNC_TIME
// (NZ), and quietly (no budget alerts) at FINANCE_NIGHT_SYNC_TIME.
// `--once` runs a single sync and exits. Logs counts only, never transactions.
import {
  createDb,
  createLogger,
  createTelegramSender,
  loadConfig,
  trackRun,
} from "@ops/core";
import { syncAccounts } from "./accounts.js";
import { createAkahuClient } from "./akahu.js";
import { applyRules, categoriseWithModel } from "./categorise.js";
import { checkBudgetAlerts } from "./budget-alerts.js";
import { createClaudeClassifier } from "./claude.js";
import { loadFinanceConfig } from "./config.js";
import { refreshBankData } from "./refresh.js";
import { nextSlot, type Slot } from "./sync-schedule.js";
import { syncTransactions } from "./transactions.js";

const config = loadConfig();
const finance = loadFinanceConfig();
const logger = createLogger(config);
const SLOTS: Slot[] = [
  { time: finance.FINANCE_SYNC_TIME, alerts: true },
  ...(finance.FINANCE_NIGHT_SYNC_TIME
    ? [{ time: finance.FINANCE_NIGHT_SYNC_TIME, alerts: false }]
    : []),
];
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

const sendAlert =
  finance.TELEGRAM_BOT_TOKEN && finance.TELEGRAM_CHAT_ID
    ? createTelegramSender({
        token: finance.TELEGRAM_BOT_TOKEN,
        chatId: finance.TELEGRAM_CHAT_ID,
      })
    : undefined;
if (!sendAlert) logger.warn("Telegram not set, skipping budget alerts");

// A failed alert never fails the sync: the next sync tries again.
async function alerts() {
  if (!sendAlert) return;
  try {
    const sent = await checkBudgetAlerts(db, sendAlert);
    if (sent) logger.info({ budgets: sent }, "budget alert sent");
  } catch {
    logger.warn("budget alert failed");
  }
}

function sync(withAlerts = true) {
  return trackRun(db, logger, "finance-sync", async () => {
    // Asking the banks first is a bonus: any failure here, a rate limit
    // included, leaves the sync to carry on with what Akahu already has.
    const refresh = await refreshBankData(akahu).catch((err: unknown) => {
      logger.warn({ err }, "bank refresh failed");
      return "failed";
    });
    logger.info({ refresh }, "bank refresh");
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
  }).then(async (ok) => {
    if (ok && withAlerts) await alerts();
    return ok;
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
    const { at, alerts } = nextSlot(new Date(), SLOTS);
    logger.info({ at: at.toISOString(), alerts }, "next finance sync");
    timer = setTimeout(
      () => void sync(alerts).then(schedule),
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
