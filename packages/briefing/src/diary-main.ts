// Sends yesterday's diary summary to Telegram at DIARY_TIME (NZ), as its own
// message, and nothing on a day with no entry. `--once` sends now and exits;
// `--once --day=YYYY-MM-DD` summarises that day instead of yesterday. Logs
// counts only, never message text.
import {
  createDb,
  createLogger,
  createTelegramSender,
  loadConfig,
  nextRun,
  trackRun,
  type Schedule,
} from "@ops/core";
import { loadDiaryConfig } from "./diary-config.js";
import { sendDiary, yesterdayNz } from "./diary.js";

const RETRY_MS = 60 * 60 * 1000;

const config = loadConfig();
const settings = loadDiaryConfig();
const logger = createLogger(config);
const db = createDb(config);
const send = createTelegramSender({
  token: settings.TELEGRAM_BOT_TOKEN,
  chatId: settings.TELEGRAM_CHAT_ID,
});
const DAILY: Schedule = { time: settings.DIARY_TIME };

const run = (day = yesterdayNz(new Date())) =>
  trackRun(db, logger, "diary", async () => {
    const sent = await sendDiary({ send, day });
    logger.info({ sent }, sent ? "diary message sent" : "no diary entry");
  });

if (process.argv.includes("--once")) {
  const day = process.argv
    .find((a) => a.startsWith("--day="))
    ?.slice("--day=".length);
  if (day !== undefined && !/^\d{4}-\d\d-\d\d$/.test(day)) {
    throw new Error("--day must look like 2026-10-12");
  }
  const ok = await run(day);
  await db.end();
  process.exitCode = ok ? 0 : 1;
} else {
  let timer: NodeJS.Timeout;
  const schedule = (at: Date) => {
    logger.info({ at: at.toISOString() }, "next diary message");
    timer = setTimeout(
      () =>
        void run().then((ok) =>
          schedule(
            ok ? nextRun(new Date(), DAILY) : new Date(Date.now() + RETRY_MS),
          ),
        ),
      at.getTime() - Date.now(),
    );
  };
  schedule(nextRun(new Date(), DAILY));
  const shutdown = () => {
    clearTimeout(timer);
    void db.end().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
