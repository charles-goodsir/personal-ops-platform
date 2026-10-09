import { createDb, createLogger, loadConfig } from "@ops/core";
import { createHttpApp, loadHttpConfig } from "./http.js";

const config = loadConfig();
const http = loadHttpConfig();
const logger = createLogger(config);
const db = createDb(config);

const server = createHttpApp({ db, logger }, http).listen(
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
