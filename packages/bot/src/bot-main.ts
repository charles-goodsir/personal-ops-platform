// Answers my Telegram commands. Long-polls Telegram (outbound calls only) and
// ignores every chat but mine. Logs counts and errors, never message text.
import {
  financeSection,
  loadBriefingConfig,
  notesSection,
  runBriefing,
  weatherSection,
} from "@ops/briefing";
import { createDb, createLogger, loadConfig } from "@ops/core";
import { createFinanceApi } from "@ops/finance";
import { createEmbedder, createNotesApi } from "@ops/knowledge-base";
import { createCommandHandler } from "./commands.js";
import { createBot } from "./poller.js";

const config = loadConfig();
const settings = loadBriefingConfig();
const logger = createLogger(config);
const db = createDb(config);

const sections = [
  financeSection(db),
  notesSection(db),
  weatherSection({ lat: settings.WEATHER_LAT, lon: settings.WEATHER_LON }),
];
const bot = createBot({
  token: settings.TELEGRAM_BOT_TOKEN,
  chatId: settings.TELEGRAM_CHAT_ID,
  logger,
  handle: createCommandHandler({
    finance: createFinanceApi(db),
    notes: createNotesApi({
      db,
      embed: createEmbedder({
        url: config.OLLAMA_URL,
        model: config.EMBED_MODEL,
      }),
      model: config.EMBED_MODEL,
    }),
    briefing: () => runBriefing(sections, { logger }),
  }),
});

const controller = new AbortController();
const shutdown = () => controller.abort();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info("bot polling for commands");
await bot.run(controller.signal);
await db.end();
