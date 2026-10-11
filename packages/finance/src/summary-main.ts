// Sends the weekly spending summary to Telegram every Monday 08:00 NZ.
// `--once` sends one now and exits. Logs counts only, never message text.
import { createDb, createLogger, loadConfig } from "@ops/core";
import { loadSummaryConfig } from "./config.js";
import {
  createClaudeSummariser,
  createTelegramSender,
  nextRun,
  sendWeeklySummary,
} from "./summary.js";

const RETRY_MS = 60 * 60 * 1000;

const config = loadConfig();
const summary = loadSummaryConfig();
const logger = createLogger(config);
const db = createDb(config);
const send = createTelegramSender({
  token: summary.TELEGRAM_BOT_TOKEN,
  chatId: summary.TELEGRAM_CHAT_ID,
});
const summarise = summary.ANTHROPIC_API_KEY
  ? createClaudeSummariser({
      apiKey: summary.ANTHROPIC_API_KEY,
      model: summary.CLAUDE_SUMMARY_MODEL,
    })
  : undefined;
if (!summarise)
  logger.warn("ANTHROPIC_API_KEY not set, summary will be plain numbers");

async function run() {
  try {
    await sendWeeklySummary({ db, send, summarise, logger });
    logger.info("weekly summary sent");
    return true;
  } catch (err) {
    logger.error({ err }, "weekly summary failed");
    return false;
  }
}

if (process.argv.includes("--once")) {
  const ok = await run();
  await db.end();
  process.exitCode = ok ? 0 : 1;
} else {
  let timer: NodeJS.Timeout;
  const schedule = (at: Date) => {
    logger.info({ at: at.toISOString() }, "next weekly summary");
    timer = setTimeout(
      () =>
        void run().then((ok) =>
          schedule(ok ? nextRun(new Date()) : new Date(Date.now() + RETRY_MS)),
        ),
      at.getTime() - Date.now(),
    );
  };
  schedule(nextRun(new Date()));
  const shutdown = () => {
    clearTimeout(timer);
    void db.end().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
