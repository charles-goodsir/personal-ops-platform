// A read-only web page for my spending, budgets and job health. It listens on
// 127.0.0.1 and is reached through an SSH tunnel. Logs counts and errors,
// never request paths or the password.
import { createServer } from "node:http";
import { createDb, createLogger, loadConfig } from "@ops/core";
import { loadDashboardConfig, readOnlyUrl } from "./config.js";
import { CSS, renderPage } from "./page.js";
import { createDashboardHandler } from "./server.js";

const config = loadConfig();
const dashboard = loadDashboardConfig();
const logger = createLogger(config);
const db = createDb({ DATABASE_URL: readOnlyUrl(config.DATABASE_URL) });

const server = createServer(
  createDashboardHandler({
    password: dashboard.DASHBOARD_PASSWORD,
    allowedHosts: dashboard.DASHBOARD_ALLOWED_HOSTS,
    logger,
    page: renderPage(db),
    css: CSS,
  }),
);
server.listen(dashboard.DASHBOARD_PORT, dashboard.DASHBOARD_HOST, () =>
  logger.info({ port: dashboard.DASHBOARD_PORT }, "dashboard listening"),
);

const shutdown = () => {
  server.close();
  void db.end().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
