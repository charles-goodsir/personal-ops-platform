// Sends one ISO 27001 clause or control to Telegram at ISO_TIME (NZ), as its own
// message, from ISO_START on. `--once` sends today's entry now and exits. Logs
// the entry id only, never the message text.
import {
  createDb,
  createLogger,
  createTelegramSender,
  loadConfig,
  nextRun,
  trackRun,
  type Schedule,
} from "@ops/core";
import { ISO_ENTRIES } from "./iso-content.js";
import { loadIsoConfig } from "./iso-config.js";
import { sendIso } from "./iso.js";

const RETRY_MS = 60 * 60 * 1000;

const config = loadConfig();
const settings = loadIsoConfig();
const logger = createLogger(config);
const db = createDb(config);
const send = createTelegramSender({
  token: settings.TELEGRAM_BOT_TOKEN,
  chatId: settings.TELEGRAM_CHAT_ID,
});
const DAILY: Schedule = { time: settings.ISO_TIME };

const run = () =>
  trackRun(db, logger, "iso", async () => {
    const sent = await sendIso({
      send,
      entries: ISO_ENTRIES,
      start: settings.ISO_START,
    });
    logger.info({ sent }, sent ? "iso message sent" : "no iso entry today");
  });

if (process.argv.includes("--once")) {
  const ok = await run();
  await db.end();
  process.exitCode = ok ? 0 : 1;
} else {
  let timer: NodeJS.Timeout;
  const schedule = (at: Date) => {
    logger.info({ at: at.toISOString() }, "next iso message");
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
