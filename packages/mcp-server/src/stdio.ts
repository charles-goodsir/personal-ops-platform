import { pino } from "pino";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDb, createLogger, loadConfig } from "@ops/core";
import { createFinanceApi, createRulesApi } from "@ops/finance";
import { createEmbedder, createNotesApi } from "@ops/knowledge-base";
import { createServer } from "./server.js";

// stdout carries the MCP protocol, so logs must go to stderr.
const config = loadConfig();
const logger = createLogger(config, pino.destination(2));
const db = createDb(config);
const notes = createNotesApi({
  db,
  embed: createEmbedder({ url: config.OLLAMA_URL, model: config.EMBED_MODEL }),
  model: config.EMBED_MODEL,
});

await createServer({
  db,
  logger,
  notes,
  rules: createRulesApi(db),
  finance: createFinanceApi(db),
}).connect(new StdioServerTransport());
logger.info("mcp-server listening on stdio");

const shutdown = async () => {
  await db.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
