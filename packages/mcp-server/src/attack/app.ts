import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { createLogger, type Db } from "@ops/core";
import type { FinanceApi, RulesApi } from "@ops/finance";
import type { NotesApi } from "@ops/knowledge-base";
import { createHttpApp, loadHttpConfig } from "../http.js";
import type { Deps } from "../server.js";

export const TOKEN = "k".repeat(32);

// The real HTTP app on a random local port, with stub dependencies and a logger
// that keeps what it writes, so a test can read the logs as well as the replies.
// Attacks run against this local copy, never the mini PC.
export async function startTestApp(
  opts: { tokens?: string[]; allowedHosts?: string; deps?: Partial<Deps> } = {},
) {
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const logger = createLogger({ LOG_LEVEL: "info" }, stream);
  const config = loadHttpConfig({
    MCP_AUTH_TOKENS: (opts.tokens ?? [TOKEN]).join(","),
    ...(opts.allowedHosts ? { MCP_ALLOWED_HOSTS: opts.allowedHosts } : {}),
  });
  const deps: Deps = {
    db: { query: async () => ({ rows: [{ ok: 1 }] }) } as unknown as Db,
    notes: {} as NotesApi,
    rules: {} as RulesApi,
    finance: {} as FinanceApi,
    logger,
    ...opts.deps,
  };
  const server = await new Promise<Server>((resolve) => {
    const s = createHttpApp(deps, config).listen(0, "127.0.0.1", () =>
      resolve(s),
    );
  });
  return {
    port: (server.address() as AddressInfo).port,
    logs,
    logger,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
