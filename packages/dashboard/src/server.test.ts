import { request, createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDashboardHandler } from "./server.js";

const password = "correct-horse-battery-staple";
const basic = (pw: string, user = "me") =>
  `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
const logger = { warn: vi.fn(), error: vi.fn() };
let clock = 1_000_000;
let pageImpl: () => Promise<string> = async () => "<h1>the page</h1>";

let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer(
    createDashboardHandler({
      password,
      allowedHosts: ["localhost", "127.0.0.1"],
      logger,
      page: () => pageImpl(),
      css: "body{}",
      now: () => clock,
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

type Reply = { status: number; headers: Record<string, unknown>; body: string };
// Raw node:http, so the Host header and repeated headers are exactly as given.
const get = (
  path: string,
  headers: Record<string, string | string[]> = {},
  method = "GET",
) =>
  new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          host: "localhost",
          authorization: basic(password),
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

test("the right password gets the page, with the security headers", async () => {
  const r = await get("/");
  expect(r.status).toBe(200);
  expect(r.body).toBe("<h1>the page</h1>");
  expect(r.headers["content-security-policy"]).toBe(
    "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  expect(r.headers["x-content-type-options"]).toBe("nosniff");
  expect(r.headers["x-frame-options"]).toBe("DENY");
  expect(r.headers["referrer-policy"]).toBe("no-referrer");
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.headers["x-powered-by"]).toBeUndefined();
  const css = await get("/style.css");
  expect(css.status).toBe(200);
  expect(css.headers["content-type"]).toContain("text/css");
});

test("D2: no password, a wrong one, or a malformed header all get 401 and no page", async () => {
  const bad: (string | undefined)[] = [
    undefined,
    "",
    basic(""),
    basic("wrong"),
    basic(password.slice(0, -1)),
    basic(password + "x"),
    basic(password.toUpperCase()),
    basic("x".repeat(10_000)),
    `Bearer ${password}`,
    `Basic ${password}`,
    "Basic !!!not-base64!!!",
    `Basic ${Buffer.from(password).toString("base64")}`, // no colon: just the password
    "basic " + basic(password).slice(6),
  ];
  for (const authorization of bad) {
    const r = await get(
      "/",
      authorization === undefined ? { authorization: [] } : { authorization },
    );
    expect(r.status, String(authorization).slice(0, 30)).toBe(401);
    expect(r.body).toBe("unauthorized");
    expect(r.headers["www-authenticate"]).toContain("Basic");
  }
});

test("D2: any user name works with the right password, and a colon in the password is fine", async () => {
  expect((await get("/", { authorization: basic(password, "") })).status).toBe(
    200,
  );
  expect(
    (await get("/", { authorization: basic(password, "x:y") })).status,
  ).toBe(401);
});

test("D2: a wrong password first and a right one second is still refused", async () => {
  const r = await get("/", {
    authorization: [basic("wrong"), basic(password)],
  });
  expect(r.status).toBe(401);
});

test("D3: a Host that is not on the list is refused, even with the right password", async () => {
  for (const host of [
    "evil.example",
    "localhost.evil.com",
    "127.0.0.1.evil.com",
    "localhost.",
    "[::1]",
    "0.0.0.0",
    "localhost:abc",
    "localhost/../x",
    "user@localhost",
    "127.1",
    "2130706433",
    "localhost%2e",
    "localhost:99999x",
  ]) {
    const r = await get("/", { host });
    expect(r.status, host).toBe(403);
    expect(r.body).toBe("forbidden");
  }
  for (const host of ["localhost", "LOCALHOST:3100", "127.0.0.1:8081"])
    expect((await get("/", { host })).status, host).toBe(200);
});

test("D4: only GET and HEAD, whatever the password", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const r = await get("/", {}, method);
    expect(r.status, method).toBe(405);
    expect(r.headers.allow).toBe("GET, HEAD");
  }
  const head = await get("/", {}, "HEAD");
  expect(head.status).toBe(200);
  expect(head.body).toBe("");
});

test("D4: two paths exist and nothing else, and a query is not echoed", async () => {
  for (const path of [
    "/admin",
    "/../etc/passwd",
    "/%2e%2e/etc/passwd",
    "/style.css/",
    "//",
    "/index.html",
    "/.env",
  ]) {
    const r = await get(path);
    expect(r.status, path).toBe(404);
    expect(r.body).toBe("not found");
  }
  const q = await get("/?x=%3Cscript%3Ealert(1)%3C/script%3E");
  expect(q.status).toBe(200);
  expect(q.body).not.toContain("script");
});

test("D6: a page that throws gives a generic 500 and logs the error", async () => {
  pageImpl = async () => {
    throw new Error("SELECT secret FROM somewhere at /app/x.js");
  };
  const r = await get("/");
  pageImpl = async () => "<h1>the page</h1>";
  expect(r.status).toBe(500);
  expect(r.body).toBe("internal error");
  expect(logger.error).toHaveBeenCalledTimes(1);
});

test("failed passwords are logged at most once every 10 seconds, and never with what was sent", async () => {
  logger.warn.mockClear();
  clock += 60_000;
  for (let i = 0; i < 5; i++)
    await get("/", { authorization: basic("guess-secret") });
  expect(logger.warn).toHaveBeenCalledTimes(1);
  clock += 11_000;
  await get("/", { authorization: basic("guess-secret") });
  expect(logger.warn).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("guess-secret");
});
