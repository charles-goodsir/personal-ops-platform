// Long-running: scans NOTES_DIR at startup, then watches it for changes.
import { createDb, createLogger, loadConfig, trackRun } from "@ops/core";
import { createEmbedder } from "./embed.js";
import { createIngester } from "./ingest.js";
import { createQueue, watchNotes } from "./watch.js";

// Backstop for missed events and folder moves.
const RESCAN_MS = 15 * 60 * 1000;

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
const queue = createQueue(logger);
const scan = () =>
  trackRun(db, logger, "knowledge-base-scan", ingester.scan).then(() => {});

void queue.enqueue(scan);
const watcher = watchNotes({
  notesDir: config.NOTES_DIR,
  ingester,
  enqueue: queue.enqueue,
  logger,
});
const rescan = setInterval(() => void queue.enqueue(scan), RESCAN_MS);
logger.info({ notesDir: config.NOTES_DIR }, "watching notes");

const shutdown = () => {
  clearInterval(rescan);
  watcher.close();
  void queue
    .idle()
    .then(() => db.end())
    .then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
