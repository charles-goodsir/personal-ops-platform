import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger, type Db } from "@ops/core";
import type { RulesApi } from "@ops/finance";
import type { NotesApi } from "@ops/knowledge-base";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createHttpApp, loadHttpConfig } from "./http.js";

const tokenA = "a".repeat(32);
const tokenB = "b".repeat(32);
const db = { query: async () => ({ rows: [{ ok: 1 }] }) } as unknown as Db;
// Auth tests never reach these tools.
const notes = {} as NotesApi;
const rules = {} as RulesApi;

let server: Server;
let url: string;

beforeAll(async () => {
  const config = loadHttpConfig({ MCP_AUTH_TOKENS: `${tokenA}, ${tokenB}` });
  const app = createHttpApp(
    { db, notes, rules, logger: createLogger({ LOG_LEVEL: "fatal" }) },
    config,
  );
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function ping(token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  const result = await client.callTool({ name: "ping" });
  await client.close();
  return result.content;
}

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
});
const post = (headers: Record<string, string>) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: initBody,
  });

test("rejects a request with no token", async () => {
  const res = await post({});
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe("Bearer");
});

test("rejects a wrong token", async () => {
  expect(
    (await post({ authorization: `Bearer ${"c".repeat(32)}` })).status,
  ).toBe(401);
});

test("rejects a non-Bearer scheme", async () => {
  expect((await post({ authorization: `Basic ${tokenA}` })).status).toBe(401);
});

test("rejects a Host header that is not allowlisted", async () => {
  // fetch won't override Host, so use the raw http module.
  const { request } = await import("node:http");
  const status = await new Promise<number>((resolve) => {
    const req = request(url, {
      method: "POST",
      headers: { host: "evil.example", authorization: `Bearer ${tokenA}` },
    });
    req.on("response", (r) => resolve(r.statusCode ?? 0));
    req.end(initBody);
  });
  expect(status).toBe(403);
});

test("ping works with either valid token", async () => {
  expect(await ping(tokenA)).toEqual([
    { type: "text", text: "pong (database: ok)" },
  ]);
  expect(await ping(tokenB)).toEqual([
    { type: "text", text: "pong (database: ok)" },
  ]);
});

test("GET is not allowed", async () => {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  expect(res.status).toBe(405);
});

test("config rejects short tokens", () => {
  expect(() => loadHttpConfig({ MCP_AUTH_TOKENS: "short" })).toThrow(
    /at least 32/,
  );
  expect(() => loadHttpConfig({})).toThrow(/MCP_AUTH_TOKENS/);
});
