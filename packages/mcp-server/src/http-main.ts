import { createDb, createLogger, loadConfig } from "@ops/core";
import { createEmbedder, createNotesApi } from "@ops/knowledge-base";
import { createHttpApp, loadHttpConfig } from "./http.js";

const config = loadConfig();
const http = loadHttpConfig();
const logger = createLogger(config);
const db = createDb(config);
const notes = createNotesApi({
  db,
  embed: createEmbedder({ url: config.OLLAMA_URL, model: config.EMBED_MODEL }),
  model: config.EMBED_MODEL,
});

const server = createHttpApp({ db, logger, notes }, http).listen(
  http.MCP_HTTP_PORT,
  http.MCP_HTTP_HOST,
  () => {
    logger.info(
      { host: http.MCP_HTTP_HOST, port: http.MCP_HTTP_PORT },
      "mcp-server listening on http",
    );
  },
);

const shutdown = () => {
  server.close(() => void db.end().then(() => process.exit(0)));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
