import { afterAll, beforeAll, expect, test } from "vitest";
import { startTestApp, TOKEN } from "./app.js";
import { buildRequest, rawHttp } from "./raw.js";

// These check the harness, not the server's defences: if they pass, a later
// attack test that sends a hostile request really sent it, and a test that reads
// the logs really sees them.
let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  app = await startTestApp();
});
afterAll(() => app.close());

const init = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
});
const mcp = (auth: [string, string][]) =>
  buildRequest({
    headers: [
      ["Host", `127.0.0.1:${app.port}`],
      ["Content-Type", "application/json"],
      ["Accept", "application/json, text/event-stream"],
      ...auth,
    ],
    body: init,
  });

test("a valid request with the right token gets through", async () => {
  const res = await rawHttp(
    app.port,
    mcp([["Authorization", `Bearer ${TOKEN}`]]),
  );
  expect(res.status).toBe(200);
  expect(res.body).toContain("protocolVersion");
});

test("no token gets a 401 with a Bearer challenge", async () => {
  const res = await rawHttp(app.port, mcp([]));
  expect(res.status).toBe(401);
  expect(res.headers).toContainEqual(["www-authenticate", "Bearer"]);
});

test("a repeated header is written as two lines, which fetch() cannot do", () => {
  const request = mcp([
    ["Authorization", `Bearer ${TOKEN}`],
    ["Authorization", "Bearer junk"],
  ]);
  expect(request.match(/^Authorization: /gm)).toHaveLength(2);
  expect(request).not.toMatch(/^Host: .*\r\nHost: /m);
});

test("a broken request line is answered by the parser, not lost", async () => {
  const res = await rawHttp(app.port, "NOT HTTP AT ALL\r\n\r\n");
  expect(res.status).toBe(400);
});

test("the logger keeps what it writes, so tests can read the logs", () => {
  app.logger.info({ probe: "harness" }, "hello");
  expect(app.logs.join("")).toContain('"probe":"harness"');
});
