import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startTestApp, TOKEN } from "./app.js";
import { buildRequest, rawHttp, type RawResponse } from "./raw.js";

// Batch A of the threat model: the MCP server's HTTP layer, from outside. Each
// test asserts the secure behaviour, so a failure is a finding.
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
const good = ["Authorization", `Bearer ${TOKEN}`] as [string, string];

// A request with sane defaults. `host: null` leaves the Host header out, and
// `auth` is a list of Authorization values (none by default).
function send(
  opts: {
    method?: string;
    path?: string;
    host?: string | null;
    auth?: string[];
    extra?: [string, string][];
    body?: string;
    contentType?: string;
  } = {},
): Promise<RawResponse> {
  const headers: [string, string][] = [];
  if (opts.host !== null)
    headers.push(["Host", opts.host ?? `127.0.0.1:${app.port}`]);
  headers.push(["Content-Type", opts.contentType ?? "application/json"]);
  headers.push(["Accept", "application/json, text/event-stream"]);
  for (const a of opts.auth ?? []) headers.push(["Authorization", a]);
  headers.push(...(opts.extra ?? []));
  return rawHttp(
    app.port,
    buildRequest({
      method: opts.method,
      path: opts.path,
      headers,
      body: opts.body ?? init,
    }),
  );
}
const authed = (o: Parameters<typeof send>[0] = {}) =>
  send({ ...o, auth: [`Bearer ${TOKEN}`] });

describe("A1: odd Authorization headers are rejected", () => {
  const cases: [string, string[]][] = [
    ["no header", []],
    ["empty value", [""]],
    ["Bearer with no token", ["Bearer"]],
    ["Bearer and a space only", ["Bearer "]],
    ["lower-case scheme", [`bearer ${TOKEN}`]],
    ["upper-case scheme", [`BEARER ${TOKEN}`]],
    ["two spaces before the token", [`Bearer  ${TOKEN}`]],
    ["a trailing newline escape", [`Bearer ${TOKEN}\\n`]],
    [
      "the Basic scheme",
      [`Basic ${Buffer.from(`u:${TOKEN}`).toString("base64")}`],
    ],
    ["the token with no scheme", [TOKEN]],
    ["one character short", [`Bearer ${TOKEN.slice(1)}`]],
    ["one character too long", [`Bearer ${TOKEN}x`]],
    ["a 10 KB token", [`Bearer ${"k".repeat(10_000)}`]],
    ["junk first, then the good token", ["Bearer junk", `Bearer ${TOKEN}`]],
  ];
  test.each(cases)("%s", async (_name, auth) => {
    const res = await send({ auth });
    expect(res.status).toBe(401);
    expect(res.body).not.toContain("protocolVersion");
  });

  test("a 100 KB token is refused before it is checked", async () => {
    const res = await send({ auth: [`Bearer ${"k".repeat(100_000)}`] });
    expect([400, 431]).toContain(res.status);
  });

  test("observation: HTTP trims a trailing space, so it is the same token", async () => {
    // Surrounding whitespace is not part of a header value, so this is not a bypass.
    expect((await send({ auth: [`Bearer ${TOKEN} `] })).status).toBe(200);
  });

  test("the token in the query string does not authenticate", async () => {
    const res = await send({ path: `/mcp?token=${TOKEN}` });
    expect(res.status).toBe(401);
  });

  test("observation: the first of two repeated headers is the one used", async () => {
    // Node drops later copies of Authorization. Fine behind nothing, but a proxy
    // that read the last copy would disagree, so this is pinned here.
    const first = await send({ auth: [`Bearer ${TOKEN}`, "Bearer junk"] });
    expect(first.status).toBe(200);
  });
});

describe("A2: failed guesses", () => {
  // Each test gets its own app: the failure log is rate-limited, so failures in
  // earlier tests would hide the first line of this one.
  test("a run of wrong tokens does not lock me out, and is recorded", async () => {
    const own = await startTestApp();
    try {
      const guess = (i: number) =>
        rawHttp(
          own.port,
          buildRequest({
            headers: [
              ["Host", `127.0.0.1:${own.port}`],
              ["Content-Type", "application/json"],
              ["Authorization", `Bearer ${"w".repeat(31)}${i % 10}`],
            ],
            body: init,
          }),
        );
      for (let i = 0; i < 50; i++) await guess(i);
      const ok = await rawHttp(
        own.port,
        buildRequest({
          headers: [
            ["Host", `127.0.0.1:${own.port}`],
            ["Content-Type", "application/json"],
            ["Accept", "application/json, text/event-stream"],
            good,
          ],
          body: init,
        }),
      );
      expect(ok.status).toBe(200); // no lockout: a stranger can't lock me out either
      const written = own.logs.join("");
      expect(written).toMatch(/mcp auth failed/); // the guessing is visible
      expect(written).not.toContain("wwwwwwww"); // and never the guess itself
      expect(written).not.toContain(TOKEN);
    } finally {
      await own.close();
    }
  });

  test("the failure log is bounded, so guessing can't fill the disk", async () => {
    const own = await startTestApp();
    try {
      await Promise.all(
        Array.from({ length: 300 }, () =>
          rawHttp(
            own.port,
            buildRequest({
              headers: [
                ["Host", `127.0.0.1:${own.port}`],
                ["Content-Type", "application/json"],
                ["Authorization", "Bearer nope"],
              ],
              body: init,
            }),
          ),
        ),
      );
      expect(own.logs.length).toBeLessThan(5);
    } finally {
      await own.close();
    }
  });
});

describe("A3: Host and Origin", () => {
  const bad = [
    "evil.com",
    "localhost.evil.com",
    "127.0.0.1.evil.com",
    "evil.com@127.0.0.1",
    "127.0.0.1@evil.com",
    "[::1]",
    "0.0.0.0",
    "",
  ];
  test.each(bad)(
    "Host %j is refused even with the right token",
    async (host) => {
      const res = await authed({ host });
      expect(res.status).not.toBe(200);
      expect([400, 403]).toContain(res.status);
    },
  );

  test("no Host header is refused", async () => {
    const res = await authed({ host: null });
    expect(res.status).not.toBe(200);
  });

  test("other spellings of the allowed address are accepted, because they are that address", async () => {
    // The check parses the Host with the URL parser, so 127.1 and 2130706433
    // become 127.0.0.1. They name the same machine, so nothing is gained.
    for (const host of ["2130706433", "0x7f.0.0.1", "127.1"])
      expect((await authed({ host })).status, host).toBe(200);
  });

  test("with two Host headers the first is used, so the bad one first is refused", async () => {
    // Node drops later copies of Host, as it does for Authorization.
    const evilFirst = await authed({
      host: "evil.com",
      extra: [["Host", "127.0.0.1"]],
    });
    expect(evilFirst.status).toBe(403);
    const goodFirst = await authed({
      host: "127.0.0.1",
      extra: [["Host", "evil.com"]],
    });
    expect(goodFirst.status).toBe(200);
  });

  test("the allowlisted names work with a port, and in any case", async () => {
    for (const host of [`127.0.0.1:${app.port}`, "LOCALHOST", "localhost:3000"])
      expect((await authed({ host })).status, host).toBe(200);
  });

  test("a trailing dot is not on the allowlist", async () => {
    expect((await authed({ host: "localhost." })).status).not.toBe(200);
  });

  test("a preflight from another origin gets no CORS permission", async () => {
    const res = await send({
      method: "OPTIONS",
      auth: [`Bearer ${TOKEN}`],
      extra: [
        ["Origin", "https://evil.com"],
        ["Access-Control-Request-Method", "POST"],
      ],
    });
    expect(res.headers.map(([n]) => n)).not.toContain(
      "access-control-allow-origin",
    );
  });

  test("a normal request from another origin gets no CORS permission", async () => {
    const res = await authed({ extra: [["Origin", "https://evil.com"]] });
    expect(res.headers.map(([n]) => n)).not.toContain(
      "access-control-allow-origin",
    );
  });
});

describe("A4: hostile bodies", () => {
  const alive = async () => expect((await authed()).status).toBe(200);

  test("invalid JSON is a clean 4xx", async () => {
    const res = await authed({ body: "{not json" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await alive();
  });
  test("an empty body is a clean 4xx", async () => {
    const res = await authed({ body: "" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await alive();
  });
  test("an empty batch is accepted, and a bare number, null or string refused", async () => {
    expect((await authed({ body: "[]" })).status).toBe(202); // a valid empty batch
    for (const body of ["123", "null", '"x"', "{}"]) {
      const res = await authed({ body });
      expect(res.status, body).toBeGreaterThanOrEqual(400);
      expect(res.status, body).toBeLessThan(500);
    }
    await alive();
  });
  test("a 1 MB body is refused", async () => {
    const res = await authed({ body: `{"a":"${"x".repeat(1_000_000)}"}` });
    expect(res.status).toBe(413);
    await alive();
  });
  test("a 20 MB body is refused without being read in full", async () => {
    const res = await authed({ body: `{"a":"${"x".repeat(20_000_000)}"}` });
    expect([413, 0]).toContain(res.status);
    await alive();
  });
  test("a small gzip body that inflates past the limit is refused", async () => {
    const big = gzipSync(Buffer.from(`{"a":"${"x".repeat(5_000_000)}"}`));
    expect(big.length).toBeLessThan(100_000);
    const res = await rawHttp(
      app.port,
      Buffer.concat([
        Buffer.from(
          buildRequest({
            headers: [
              ["Host", `127.0.0.1:${app.port}`],
              ["Content-Type", "application/json"],
              ["Accept", "application/json, text/event-stream"],
              good,
              ["Content-Encoding", "gzip"],
              ["Content-Length", String(big.length)],
            ],
          }),
          "latin1",
        ),
        big,
      ]),
    );
    expect(res.status).toBe(413);
    await alive();
  });
  test("10,000 levels of nesting are refused cleanly", async () => {
    const body = "[".repeat(10_000) + "]".repeat(10_000);
    const res = await authed({ body });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await alive();
  });
  test("a wrong Content-Type is refused", async () => {
    const res = await authed({ contentType: "text/plain" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
  test("a Content-Length that lies does not hang the server", async () => {
    const res = await rawHttp(
      app.port,
      buildRequest({
        headers: [
          ["Host", `127.0.0.1:${app.port}`],
          ["Content-Type", "application/json"],
          good,
          ["Content-Length", "1000"],
        ],
        body: "{}",
      }),
      500,
    );
    expect(res.status).toBe(0); // it waits for the rest, and gives up with the client
    await alive();
  });
  test("an unknown method name is a JSON-RPC error, not a crash", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "__proto__" });
    const res = await authed({ body });
    expect(res.status).toBeLessThan(500);
    await alive();
  });
});

describe("A5: failure responses give nothing away", () => {
  const leaks = [
    /node_modules/,
    /\/Users\//,
    /\bat .*\.(ts|js):\d+/,
    /Error:/,
    /SELECT /i,
  ];
  test("none of the failures above show a stack, path or query", async () => {
    const responses = await Promise.all([
      send(),
      send({ auth: ["Bearer x"] }),
      authed({ host: "evil.com" }),
      authed({ body: "{not json" }),
      authed({ method: "GET" }),
      send({ path: "/nowhere" }),
    ]);
    for (const r of responses)
      for (const re of leaks) expect(r.raw).not.toMatch(re);
  });
  test("errors are JSON, never an HTML page", async () => {
    for (const res of [
      await authed({ body: "{not json" }),
      await authed({ body: `{"a":"${"x".repeat(1_000_000)}"}` }),
      await send({ path: "/nowhere" }),
    ])
      expect(res.headers).toContainEqual([
        "content-type",
        expect.stringContaining("application/json"),
      ]);
  });
  test("the framework is not announced", async () => {
    const res = await send();
    expect(res.headers.map(([n]) => n)).not.toContain("x-powered-by");
  });
  test("an unknown path does not say what exists", async () => {
    for (const p of ["/", "/health", "/admin", "/.env", "/mcp/../.env"]) {
      const res = await send({ path: p });
      expect([401, 404], p).toContain(res.status);
    }
  });
});

describe("A6: bursts and slow clients (local copy only)", () => {
  test("300 unauthenticated requests at once are never served, and it keeps working", async () => {
    // Past about 128 at once the OS drops connections (status 0 here) because of
    // its listen backlog. That is the OS, not the app: nothing is ever served.
    const results = await Promise.all(
      Array.from({ length: 300 }, () => send()),
    );
    expect(results.every((r) => r.status === 0 || r.status === 401)).toBe(true);
    expect(results.filter((r) => r.status === 401).length).toBeGreaterThan(100);
    expect((await authed()).status).toBe(200);
  });
  test("an unauthenticated body is never read: bad JSON and a big body are a plain 401", async () => {
    expect((await send({ body: "{not json" })).status).toBe(401);
    expect(
      (await send({ body: `{"a":"${"x".repeat(200_000)}"}` })).status,
    ).toBe(401);
  });
  test("50 half-open connections do not stop a real request", async () => {
    const { connect } = await import("node:net");
    const sockets = Array.from({ length: 50 }, () => {
      const s = connect(app.port, "127.0.0.1");
      s.on("error", () => {});
      s.write("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Le");
      return s;
    });
    try {
      expect((await authed()).status).toBe(200);
    } finally {
      sockets.forEach((s) => s.destroy());
    }
  });
});

describe("A7: methods and paths", () => {
  test.each(["GET", "PUT", "DELETE", "PATCH", "HEAD"])(
    "%s on /mcp is 405 with the right token",
    async (method) => {
      expect((await authed({ method })).status).toBe(405);
    },
  );
  test("OPTIONS needs the token like everything else", async () => {
    expect((await send({ method: "OPTIONS" })).status).toBe(401);
  });
  test.each(["GET", "PUT", "DELETE"])(
    "%s with no token is 401, not a hint that the route exists",
    async (method) => {
      expect((await send({ method })).status).toBe(401);
    },
  );
  const variants = [
    "/mcp/",
    "/MCP",
    "//mcp",
    "/mcp//",
    "/mcp/x",
    "/mcp%2f",
    "/mcp;a=b",
    "/mcp/.",
    "/%6dcp",
  ];
  test.each(variants)("%s without a token never returns 200", async (path) => {
    const res = await send({ path });
    expect(res.status).not.toBe(200);
    expect([400, 401, 404]).toContain(res.status);
  });
});
