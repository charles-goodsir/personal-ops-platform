import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

// Stateless: a fresh server and transport per request, so no session state to leak between callers.
export function createHttpApp(deps: Deps, config: HttpConfig) {
  const app = createMcpExpressApp({
    host: config.MCP_HTTP_HOST,
    allowedHosts: config.MCP_ALLOWED_HOSTS,
  });
  app.use("/mcp", bearerAuth(config.MCP_AUTH_TOKENS));

  app.post("/mcp", async (req, res) => {
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

  return app;
}
