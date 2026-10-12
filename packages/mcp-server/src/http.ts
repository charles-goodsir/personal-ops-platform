import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { bearerAuth } from "./auth.js";
import { createServer, type Deps } from "./server.js";

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const schema = z.object({
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_ALLOWED_HOSTS: z.string().default("localhost,127.0.0.1").transform(csv),
  MCP_AUTH_TOKENS: z
    .string()
    .transform(csv)
    .pipe(
      z
        .array(z.string().min(32, "each token must be at least 32 characters"))
        .min(1),
    ),
});

export type HttpConfig = z.infer<typeof schema>;

export function loadHttpConfig(
  env: NodeJS.ProcessEnv = process.env,
): HttpConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid HTTP config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}

// What a request asked for, for the audit line: the JSON-RPC method, the tool
// name, and the NAMES of the arguments. Never their values, which can hold my
// data. Everything is cut short, because the caller chose it.
const cut = (v: unknown, n: number) =>
  typeof v === "string" ? v.slice(0, n) : undefined;
function describeCalls(body: unknown) {
  const messages = Array.isArray(body) ? body : [body];
  return messages.slice(0, 10).map((m: unknown) => {
    const msg = (m ?? {}) as {
      method?: unknown;
      params?: Record<string, unknown>;
    };
    const args = msg.params?.arguments;
    return {
      method: cut(msg.method, 50),
      tool: cut(msg.params?.name, 50),
      args:
        args && typeof args === "object" && !Array.isArray(args)
          ? Object.keys(args)
              .slice(0, 20)
              .map((k) => k.slice(0, 50))
          : [],
    };
  });
}

// Stateless: a fresh server and transport per request, so no session state to leak between callers.
export function createHttpApp(deps: Deps, config: HttpConfig): express.Express {
  // The order matters. The Host check and the token come before the body is
  // read, so a stranger gets a refusal without reaching the JSON parser, and the
  // framework is not announced.
  const app = express();
  app.disable("x-powered-by");
  app.use(hostHeaderValidation(config.MCP_ALLOWED_HOSTS));
  app.use("/mcp", bearerAuth(config.MCP_AUTH_TOKENS, deps.logger));
  app.use("/mcp", express.json());

  app.post("/mcp", async (req, res) => {
    // One line per request that got past the token: what was asked, how it
    // ended and how long it took. Refused requests are logged by the auth check.
    const started = Date.now();
    res.on("finish", () => {
      deps.logger.info(
        {
          calls: describeCalls(req.body),
          status: res.statusCode,
          ms: Date.now() - started,
          ip: req.ip,
        },
        "mcp request",
      );
    });
    const server = createServer(deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      deps.logger.error({ err }, "mcp http request failed");
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  });

  // Stateless mode has no server-initiated stream or session to delete.
  app.all("/mcp", (_req, res) => {
    res.set("Allow", "POST").status(405).json({ error: "method not allowed" });
  });

  // Errors and unknown paths are JSON, never Express's HTML page, which shows a
  // stack when NODE_ENV is not "production".
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  app.use(
    (
      err: { status?: number },
      _req: express.Request,
      res: express.Response,
      // Express only treats a 4-argument function as an error handler.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      const status =
        typeof err.status === "number" && err.status >= 400 && err.status < 500
          ? err.status
          : 500;
      if (status === 500) deps.logger.error({ err }, "mcp http error");
      res.status(status).json({
        error:
          status === 413
            ? "payload too large"
            : status === 500
              ? "internal error"
              : "bad request",
      });
    },
  );

  return app;
}
