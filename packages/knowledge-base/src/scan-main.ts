// One-shot: index NOTES_DIR once and exit. The watcher service comes later.
import { createDb, createLogger, loadConfig } from "@ops/core";
import { createEmbedder } from "./embed.js";
import { createIngester } from "./ingest.js";

const config = loadConfig();
const logger = createLogger(config);
const db = createDb(config);
const ingester = createIngester({
  db,
  embed: createEmbedder({ url: config.OLLAMA_URL, model: config.EMBED_MODEL }),
  model: config.EMBED_MODEL,
  notesDir: config.NOTES_DIR,
  logger,
});

try {
  const counts = await ingester.scan();
  process.exitCode = counts.failed ? 1 : 0;
} finally {
  await db.end();
}
