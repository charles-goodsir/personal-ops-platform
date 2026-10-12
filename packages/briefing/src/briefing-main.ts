// Sends the daily briefing to Telegram at BRIEFING_TIME (NZ). `--once` sends
// one now and exits. Logs section failures by name, never message text.
import {
  createDb,
  createLogger,
  createTelegramSender,
  loadConfig,
  nextRun,
  trackRun,
  type Schedule,
} from "@ops/core";
import { loadBriefingConfig } from "./config.js";
import { financeSection } from "./finance-section.js";
import { notesSection } from "./notes-section.js";
import { runBriefing } from "./runner.js";
import { weatherSection } from "./weather-section.js";

const RETRY_MS = 60 * 60 * 1000;

const config = loadConfig();
const briefing = loadBriefingConfig();
const logger = createLogger(config);
const db = createDb(config);
const send = createTelegramSender({
  token: briefing.TELEGRAM_BOT_TOKEN,
  chatId: briefing.TELEGRAM_CHAT_ID,
});
const sections = [
  financeSection(db),
  notesSection(db),
  weatherSection({ lat: briefing.WEATHER_LAT, lon: briefing.WEATHER_LON }),
];
const DAILY: Schedule = { time: briefing.BRIEFING_TIME };

const run = () =>
  trackRun(db, logger, "briefing", async () => {
    await send(await runBriefing(sections, { logger }));
    logger.info("daily briefing sent");
  });

if (process.argv.includes("--once")) {
  const ok = await run();
  await db.end();
  process.exitCode = ok ? 0 : 1;
} else {
  let timer: NodeJS.Timeout;
  const schedule = (at: Date) => {
    logger.info({ at: at.toISOString() }, "next daily briefing");
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
