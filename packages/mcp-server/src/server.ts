import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkDb, type Db, type Logger } from "@ops/core";

export interface Deps {
  db: Db;
  logger: Logger;
}

export function createServer({ db, logger }: Deps): McpServer {
  const server = new McpServer({ name: "personal-ops", version: "0.0.0" });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Health check. Returns pong and whether the database is reachable.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const dbOk = await checkDb(db).catch((err: unknown) => {
        logger.warn({ err }, "ping: database check failed");
        return false;
      });
      return {
        content: [
          {
            type: "text",
            text: `pong (database: ${dbOk ? "ok" : "unreachable"})`,
          },
        ],
      };
    },
  );

  return server;
}
