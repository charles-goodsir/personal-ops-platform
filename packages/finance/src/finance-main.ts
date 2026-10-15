// Syncs accounts then transactions from Akahu, then categorises: my rules
// first, the model for whatever is left. At startup, daily at FINANCE_SYNC_TIME
// (NZ), and quietly (no alerts) at FINANCE_NIGHT_SYNC_TIME.
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
import { createClaudeClassifier } from "./claude.js";
import { loadFinanceConfig } from "./config.js";
import { createGoalsApi } from "./goals.js";
import { sendPaydayMessage } from "./payday-message.js";
import { fortnightSpent, paySeen } from "./payday-plan.js";
import { createPaydaySettingsApi } from "./payday-settings.js";
import { syncPending } from "./pending.js";
import { refreshBankData } from "./refresh.js";
import { checkSpendingAlert } from "./spending-alert.js";
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
if (!sendAlert) logger.warn("Telegram not set, skipping alerts");

const paydaySettings = createPaydaySettingsApi(db);
const paydayGoals = createGoalsApi(db);

// What goes to Telegram after a morning sync. A failure of either never fails
// the sync, and each is tried again at the next one.
async function alerts() {
  if (!sendAlert) return;
  try {
    const level = await checkSpendingAlert(
      db,
      await paydaySettings.getSettings(),
      sendAlert,
    );
    if (level) logger.info({ level }, "spending alert sent");
  } catch {
    logger.warn("spending alert failed");
  }
  try {
    const result = await sendPaydayMessage({
      settings: paydaySettings,
      goals: paydayGoals,
      spent: (payday) => fortnightSpent(db, payday),
      paySeen: (payday, pay) => paySeen(db, payday, pay),
      send: sendAlert,
    });
    if (result === "sent") logger.info("payday message sent");
  } catch {
    logger.warn("payday message failed");
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
    // A bonus like the refresh: a failure here never fails the sync.
    const pending = await syncPending(db, akahu);
    if ("error" in pending)
      logger.warn({ err: pending.error }, "pending sync failed");
    else logger.info(pending, "pending synced");
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
