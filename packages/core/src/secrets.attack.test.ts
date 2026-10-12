import { Writable } from "node:stream";
import { expect, test } from "vitest";
import { pingHealthcheck } from "./healthcheck.js";
import { createLogger } from "./logger.js";
import { callTelegram, createTelegramSender } from "./telegram.js";

// Batch C (C7) of the threat model: a secret ending up in a log line or an error
// message. Each test plants a known fake secret and searches what comes out.
const TOKEN = "123456:FAKE-bot-token-abcdef";
const PING = "https://hc-ping.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { text: () => lines.join(""), stream };
}

test("C7: config-style names are redacted, at the top, one level down and two levels down", () => {
  const secrets = {
    TELEGRAM_BOT_TOKEN: TOKEN,
    MCP_AUTH_TOKENS: "mcp-token-SECRET-1,mcp-token-SECRET-2",
    ANTHROPIC_API_KEY: "sk-ant-SECRET-key",
    AKAHU_APP_TOKEN: "app_token_SECRET",
    AKAHU_USER_TOKEN: "user_token_SECRET",
    HEALTHCHECK_PING_URL: PING,
    POSTGRES_PASSWORD: "pg-SECRET-password",
    DATABASE_URL: "postgres://u:pg-SECRET-password@db/db",
  };
  for (const wrap of [
    (o: object) => o,
    (o: object) => ({ config: o }),
    (o: object) => ({ outer: { config: o } }),
  ]) {
    const { text, stream } = capture();
    createLogger({ LOG_LEVEL: "info" }, stream).info(wrap(secrets), "oops");
    expect(text()).not.toMatch(/SECRET|FAKE-bot|aaaaaaaa-bbbb/);
  }
});

test("C7: request headers are redacted wherever they sit in a logged object", () => {
  const headers = {
    authorization: "Bearer SECRET-bearer",
    Authorization: "Bearer SECRET-bearer-2",
    "x-api-key": "SECRET-api-key",
    "X-Akahu-Id": "SECRET-akahu",
    cookie: "SECRET-cookie",
  };
  for (const wrap of [
    (o: object) => ({ headers: o }),
    (o: object) => ({ req: { headers: o } }),
    (o: object) => ({ err: { config: { headers: o } } }),
  ]) {
    const { text, stream } = capture();
    createLogger({ LOG_LEVEL: "info" }, stream).error(wrap(headers), "oops");
    expect(text()).not.toContain("SECRET");
  }
});

test("C7: an error from a failed Telegram call never carries the bot token", async () => {
  // Some runtimes put the request URL in the message of a network error.
  const fetchFn = (async () => {
    throw new TypeError(
      `fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`,
    );
  }) as typeof fetch;
  for (const call of [
    () =>
      callTelegram({ token: TOKEN, method: "getUpdates", body: {}, fetchFn }),
    () => createTelegramSender({ token: TOKEN, chatId: "42", fetchFn })("hi"),
  ]) {
    const err = await call().catch((e: unknown) => e);
    expect(String(err)).not.toContain("FAKE-bot");
    expect((err as Error).stack ?? "").not.toContain("FAKE-bot");
    expect(String((err as { cause?: unknown }).cause ?? "")).not.toContain(
      "FAKE-bot",
    );
  }
});

test("C7: an error from a failed ping never carries the ping URL", async () => {
  const fetchFn = (async () => {
    throw new TypeError(`fetch failed: ${PING}`);
  }) as typeof fetch;
  const err = await pingHealthcheck({ url: PING, fetchFn }).catch(
    (e: unknown) => e,
  );
  expect(String(err)).not.toContain("aaaaaaaa-bbbb");
  expect(String((err as { cause?: unknown }).cause ?? "")).not.toContain(
    "aaaaaaaa-bbbb",
  );
});

test("C7: a Telegram error reply that echoes the token in its description is not passed on", async () => {
  const fetchFn = (async () =>
    Response.json(
      { ok: false, description: `bad request for bot${TOKEN}` },
      { status: 400 },
    )) as typeof fetch;
  const err = await callTelegram({
    token: TOKEN,
    method: "sendMessage",
    body: {},
    fetchFn,
  }).catch((e: unknown) => e);
  expect(String(err)).not.toContain("FAKE-bot");
});
