// Batch D of docs/security-testing.md: attacks on the dashboard, run against
// the real handler and, where a test needs data, a throwaway database.
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { createDb, createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { readOnlyUrl } from "./config.js";
import { CSS, renderPage } from "./page.js";
import { createDashboardHandler } from "./server.js";

const password = "correct-horse-battery-staple";
const auth = `Basic ${Buffer.from(`me:${password}`).toString("base64")}`;
// 07:00 NZDT on 15 October.
const now = new Date("2026-10-14T18:00:00Z");
const needsDb = test.skipIf(!process.env.DATABASE_URL);

const logger = { warn: vi.fn(), error: vi.fn() };
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let server: Server;
let port: number;

// Sends the bytes exactly as given, which fetch() cannot: a missing Host, a
// repeated header, a broken request line. status 0 means nothing came back.
function raw(request: string | Buffer, timeoutMs = 3000) {
  return new Promise<{ status: number; head: string; body: string }>(
    (resolve) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      const done = () => {
        socket.destroy();
        const split = data.indexOf("\r\n\r\n");
        resolve({
          status: Number(/^HTTP\/\d\.\d (\d{3})/.exec(data)?.[1] ?? 0),
          head: split === -1 ? data : data.slice(0, split),
          body: split === -1 ? "" : data.slice(split + 4),
        });
      };
      socket.setTimeout(timeoutMs, done);
      socket.on("data", (c) => (data += c));
      socket.on("close", done);
      socket.on("error", done);
      socket.write(request);
    },
  );
}
const get = (
  path: string,
  headers: [string, string][] = [
    ["Host", "localhost"],
    ["Authorization", auth],
  ],
  method = "GET",
) =>
  raw(
    `${method} ${path} HTTP/1.1\r\n${headers.map(([n, v]) => `${n}: ${v}`).join("\r\n")}\r\nConnection: close\r\n\r\n`,
  );

// Text meant to break out of an element or an attribute.
const markup = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `' onmouseover='alert(1)`,
  `</title><svg onload=alert(1)>`,
];
// Card and account numbers as they might appear in a payee name.
const numbers = [
  `4111 1111 1111 1111`,
  `4111-1111-1111-1111`,
  `01-0123-0123456-00`,
  `************1234`,
  `Ref 123456789012`,
];

// Every `<` on the page must open a tag of the shape this page writes, with
// only attributes it uses. Injected markup, or an attribute broken out of its
// quotes, leaves a `<` or an unknown attribute behind.
const KNOWN_ATTRS = new Set([
  "lang", "charset", "name", "content", "rel", "href", "class", "width", "height",
  "x", "y", "x1", "x2", "y1", "y2", "rx", "role", "aria-label", "text-anchor",
  "colspan", "overflow",
]); // prettier-ignore
function unknownMarkup(html: string): string[] {
  const problems: string[] = [];
  const tag = /<\/?([a-z0-9]+)((?:\s+[a-z0-9-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  for (const m of html.matchAll(tag))
    for (const a of (m[2] ?? "")
      .replace(/="[^"]*"/g, "")
      .matchAll(/\s+([a-z0-9-]+)/gi))
      if (!KNOWN_ATTRS.has((a[1] as string).toLowerCase()))
        problems.push(`attribute ${a[1]} on <${m[1]}>`);
  const rest = html.replace(tag, "").replace(/<!doctype html>/i, "");
  if (rest.includes("<")) problems.push("a stray <");
  return problems;
}

beforeAll(async () => {
  testDb = await createTestDb("dashboard_attack");
  const db = testDb?.db;
  if (db) {
    await db.query(
      `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
       VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
    );
    let n = 0;
    // Each hostile text becomes a monthly subscription, which is where a payee
    // name is shown, and one spending category and one goal name as well.
    for (const text of [...markup, ...numbers])
      for (const month of ["06", "07", "08", "09", "10"])
        await db.query(
          `INSERT INTO transactions (akahu_id, account_id, date, description, merchant, amount, type, category, synced_at)
           VALUES ($1, 'acc', $2::date + time '10:59', 'SHOP', $3, -20, 'EFTPOS', $4, now())`,
          [
            `t${++n}`,
            `2026-${month}-05`,
            text,
            // Markup also goes in as a category name, which the page shows.
            month === "10" && markup.includes(text) ? text : "Other",
          ],
        );
    // A goal name that the bot would refuse, put in directly, as the worst case.
    await db.query("INSERT INTO goals (name, target) VALUES ($1, 10)", [
      markup[0],
    ]);
  }
  server = createServer(
    createDashboardHandler({
      password,
      allowedHosts: ["localhost", "127.0.0.1"],
      logger,
      page: db
        ? renderPage(db, { hidePayees: false, now: () => now })
        : async () => "<h1>no database</h1>",
      css: CSS,
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await testDb?.drop();
});

needsDb(
  "D1: hostile text in a payee, a category and a goal name is never markup",
  async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    // The values really reached the page, as text with the angle brackets escaped.
    expect(r.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(r.body).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    // No tag from the hostile text exists, and no attribute was broken out of.
    expect(r.body).not.toMatch(/<script/i);
    expect(r.body).not.toMatch(/<img/i);
    expect(unknownMarkup(r.body)).toEqual([]);
    // If something did slip through, the policy would still stop it running.
    expect(r.head).toContain("default-src 'none'");
    expect(r.head).not.toContain("unsafe-inline");
  },
);

needsDb(
  "D5: card and account numbers in payee names never reach the page",
  async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    for (const leak of ["4111", "1111", "0123456", "123456789012", "1234"])
      expect(r.body, leak).not.toContain(leak);
    expect(r.body).toContain("[number]");
    expect(r.body).toContain("[card]");
  },
);

needsDb(
  "D4: RESET ROLE does not undo the read-only role, but SET ROLE to my own user does (accepted, ADR 11)",
  async () => {
    const { rows } = await (testDb?.db as Db).query<{ schema: string }>(
      "SELECT current_schema() AS schema",
    );
    await (testDb?.db as Db).query(
      `GRANT USAGE ON SCHEMA ${rows[0]?.schema} TO dashboard_ro`,
    );
    const url = new URL(process.env.DATABASE_URL as string);
    url.searchParams.set("options", `-c search_path=${rows[0]?.schema},public`);
    const ro = createDb({ DATABASE_URL: readOnlyUrl(url.href) });
    const client = await ro.connect();
    const who = async () =>
      (await client.query("SELECT current_user AS u, session_user AS s"))
        .rows[0] as { u: string; s: string };
    try {
      const before = await who();
      expect(before.u).toBe("dashboard_ro");
      await client.query("RESET ROLE");
      expect((await who()).u).toBe("dashboard_ro"); // the startup setting is the default
      // This pins the decision: arbitrary SQL can switch to the login user. The
      // dashboard runs fixed queries only. A login role would close it.
      await client.query(`SET ROLE "${before.s}"`);
      expect((await who()).u).toBe(before.s);
    } finally {
      client.release();
      await ro.end();
    }
  },
);

test("D2/D3: a password in the query string or a spoofed forwarding header gets nothing", async () => {
  const noAuth: [string, string][] = [["Host", "localhost"]];
  for (const path of [
    `/?password=${encodeURIComponent(password)}`,
    `/?authorization=${encodeURIComponent(auth)}`,
  ])
    expect((await get(path, noAuth)).status).toBe(401);
  const forwarded = await get("/", [
    ["Host", "localhost"],
    ["X-Forwarded-Host", "evil.example"],
    ["X-Forwarded-For", "10.0.0.1"],
    ["Authorization", auth],
  ]);
  expect(forwarded.status).toBe(200);
  expect(forwarded.body).not.toContain("evil.example");
});

test("D3: a missing Host, an absolute URL with another Host, and HTTP/1.0 are never served", async () => {
  expect(
    (await raw(`GET / HTTP/1.1\r\nAuthorization: ${auth}\r\n\r\n`)).status,
  ).not.toBe(200);
  expect(
    (await raw(`GET / HTTP/1.0\r\nAuthorization: ${auth}\r\n\r\n`)).status,
  ).not.toBe(200);
  const abs = await get("http://localhost/", [
    ["Host", "evil.example"],
    ["Authorization", auth],
  ]);
  expect(abs.status).toBe(403);
  const other = await get("http://evil.example/", [
    ["Host", "localhost"],
    ["Authorization", auth],
  ]);
  expect(other.status).toBe(404);
});

test("D3: no response ever grants a cross-origin read or embeds the page", async () => {
  const origin: [string, string][] = [["Origin", "https://evil.example"]];
  const requests: [string, [string, string][]][] = [
    ["/", [["Host", "localhost"], ["Authorization", auth], ...origin]],
    ["/", [["Host", "localhost"], ...origin]],
    ["/", [["Host", "evil.example"], ...origin]],
    ["/nope", [["Host", "localhost"], ["Authorization", auth], ...origin]],
    ["/style.css", [["Host", "localhost"], ["Authorization", auth], ...origin]],
  ];
  for (const [path, headers] of requests) {
    const r = await get(path, headers);
    expect(r.head.toLowerCase(), path).not.toContain("access-control-allow");
    expect(r.head, path).toContain("frame-ancestors 'none'");
  }
  const preflight = await get(
    "/",
    [
      ["Host", "localhost"],
      ["Origin", "https://evil.example"],
      ["Access-Control-Request-Method", "GET"],
    ],
    "OPTIONS",
  );
  expect(preflight.status).toBe(405);
  expect(preflight.head.toLowerCase()).not.toContain("access-control-allow");
});

test("D4: odd paths and methods never serve a file or change anything", async () => {
  for (const path of [
    "/style.css%00.html",
    "/%2e%2e/%2e%2e/etc/passwd",
    "/..%2f..%2fetc/passwd",
    "/style.css/../../etc/passwd",
    "/\\..\\..\\etc\\passwd",
    "/.git/config",
    "/?a=" + "x".repeat(5000),
  ]) {
    const r = await get(path);
    expect([200, 404], path).toContain(r.status);
    expect(r.body, path).not.toContain("root:");
  }
  for (const method of ["TRACE", "CONNECT", "PROPFIND", "get", "G\u0000T"]) {
    const r = await get("/", undefined, method);
    expect(r.status, method).not.toBe(200);
  }
});

test("D2/D4: a broken request line, conflicting lengths and a huge header or URL don't stop the server", async () => {
  expect((await raw("GARBAGE\r\n\r\n")).status).not.toBe(200);
  expect(
    (
      await raw(
        `GET / HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${auth}\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
      )
    ).status,
  ).not.toBe(200);
  expect(
    (
      await raw(
        `GET / HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${"A".repeat(100_000)}\r\n\r\n`,
      )
    ).status,
  ).toBe(431);
  expect(
    (
      await raw(
        `GET /${"a".repeat(100_000)} HTTP/1.1\r\nHost: localhost\r\n\r\n`,
      )
    ).status,
  ).not.toBe(200);
  expect((await get("/")).status).toBe(200); // still up
});

needsDb(
  "D6: when the database is down the reply is generic and the error is only logged",
  async () => {
    const dead = createDb({
      DATABASE_URL: "postgres://nobody:secretpw@127.0.0.1:1/none",
    });
    const s = createServer(
      createDashboardHandler({
        password,
        allowedHosts: ["localhost"],
        logger,
        page: renderPage(dead, { hidePayees: false }),
        css: CSS,
      }),
    );
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    try {
      const p = (s.address() as AddressInfo).port;
      const r = await new Promise<string>((resolve) => {
        const socket = connect(p, "127.0.0.1");
        let data = "";
        socket.on("data", (c) => (data += c));
        socket.on("close", () => resolve(data));
        socket.write(
          `GET / HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${auth}\r\nConnection: close\r\n\r\n`,
        );
      });
      expect(r).toContain("500");
      expect(r).toContain("internal error");
      for (const leak of [
        "ECONNREFUSED",
        "127.0.0.1:1",
        "secretpw",
        "nobody",
        "postgres://",
      ])
        expect(r, leak).not.toContain(leak);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
      await dead.end().catch(() => {});
    }
  },
);

test("D2/D7: 300 wrong passwords in bursts of 50 all get 401, log at most twice, and the right one still works", async () => {
  logger.warn.mockClear();
  // Bursts of 50: past about 128 connections at once, my Mac's OS drops them
  // before the server sees them (the same limit as batch A).
  const replies = [];
  for (let burst = 0; burst < 6; burst++)
    replies.push(
      ...(await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          get("/", [
            ["Host", "localhost"],
            [
              "Authorization",
              `Basic ${Buffer.from(`me:guess${burst}-${i}`).toString("base64")}`,
            ],
          ]),
        ),
      )),
    );
  expect(replies.filter((r) => r.status === 401)).toHaveLength(300);
  expect(replies.filter((r) => r.status === 200)).toHaveLength(0);
  expect(logger.warn.mock.calls.length).toBeLessThanOrEqual(2);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("guess");
  expect((await get("/")).status).toBe(200);
});

needsDb(
  "D7: 100 real page loads at once all succeed, and 50 half-open connections don't block a real one",
  async () => {
    const started = Date.now();
    const pages = await Promise.all(
      Array.from({ length: 100 }, () => get("/")),
    );
    expect(pages.filter((r) => r.status === 200)).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(20_000);
    const stuck = Array.from({ length: 50 }, () => {
      const s = connect(port, "127.0.0.1");
      s.on("error", () => {});
      s.write("GET / HTTP/1.1\r\nHost: localhost\r\n"); // never finished
      return s;
    });
    try {
      expect((await get("/")).status).toBe(200);
    } finally {
      for (const s of stuck) s.destroy();
    }
  },
);
