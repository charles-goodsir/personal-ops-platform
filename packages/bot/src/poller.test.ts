import type { Logger } from "@ops/core";
import { expect, test, vi } from "vitest";
import {
  createBot,
  createRateLimiter,
  isAuthorised,
  type Update,
} from "./poller.js";

const ME = "42";
const msg = (
  id: number,
  text: string | undefined,
  over: Partial<{ chat: number; type: string; from: number }> = {},
): Update => ({
  update_id: id,
  message: {
    text,
    chat: { id: over.chat ?? 42, type: over.type ?? "private" },
    from: { id: over.from ?? 42 },
  },
});

function setup(handle = vi.fn(async (t: string) => `echo ${t}`)) {
  const sent: string[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
    sent.push(JSON.parse(init?.body as string).text);
    return Response.json({ ok: true, result: true });
  });
  const logger = { warn: vi.fn(), error: vi.fn() };
  const bot = createBot({
    token: "123456:secret-token",
    chatId: ME,
    handle,
    logger: logger as unknown as Logger,
    fetchFn,
  });
  return { bot, handle, sent, logger, fetchFn };
}

test("an update from my own private chat runs the handler and replies to me", async () => {
  const { bot, handle, sent, fetchFn } = setup();
  expect(await bot.process([msg(7, "/help")])).toBe(8);
  expect(handle).toHaveBeenCalledWith("/help");
  expect(sent).toEqual(["echo /help"]);
  const body = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string);
  expect(body.chat_id).toBe(ME);
});

test("other chats, groups, wrong senders and non-messages are ignored with no reply", async () => {
  const { bot, handle, sent, logger } = setup();
  const strangers: Update[] = [
    msg(1, "/spend", { chat: 99, from: 99 }), // someone else
    msg(2, "/spend", { type: "group" }), // my id, but a group
    msg(3, "/spend", { from: 99 }), // my chat, a different sender
    { update_id: 4 }, // not a message at all
  ];
  expect(await bot.process(strangers)).toBe(5);
  expect(handle).not.toHaveBeenCalled();
  expect(sent).toEqual([]);
  expect(logger.warn).toHaveBeenCalledWith(
    { ignored: 4 },
    "ignored messages from other chats",
  );
  // The log carries a count, never what a stranger wrote.
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/spend");
});

test("isAuthorised needs a private chat whose chat id and sender id both match", () => {
  expect(isAuthorised(msg(1, "x"), ME)).toBe(true);
  expect(isAuthorised(msg(1, "x", { from: 1 }), ME)).toBe(false);
  expect(isAuthorised(msg(1, "x", { type: "supergroup" }), ME)).toBe(false);
  expect(isAuthorised(msg(1, "x"), "43")).toBe(false);
});

test("a message with no text, such as a photo, is skipped", async () => {
  const { bot, handle } = setup();
  await bot.process([msg(1, undefined)]);
  expect(handle).not.toHaveBeenCalled();
});

test("a handler that throws gets a generic reply, and the text stays out of the log", async () => {
  const { bot, sent, logger } = setup(
    vi.fn(async () => {
      throw new Error("db down");
    }),
  );
  await bot.process([msg(1, "/spend secret-words")]);
  expect(sent).toEqual(["Something went wrong."]);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-words");
});

test("rate limit: the 11th message in a minute is dropped, and the window slides", () => {
  const allow = createRateLimiter(10, 60_000);
  const first = Array.from({ length: 10 }, (_, i) => allow(i * 1000));
  expect(first.every(Boolean)).toBe(true);
  expect(allow(10_000)).toBe(false);
  expect(allow(60_500)).toBe(true); // the first message has aged out
});

test("the bot drops messages over the limit and says so in the log", async () => {
  const { bot, handle, logger } = setup();
  const updates = Array.from({ length: 12 }, (_, i) => msg(i + 1, "/help"));
  await bot.process(updates);
  expect(handle).toHaveBeenCalledTimes(10);
  expect(logger.warn).toHaveBeenCalledWith(
    "rate limit reached, message dropped",
  );
});

test("the offset moves past the newest update, even when everything was ignored", async () => {
  const { bot } = setup();
  expect(
    await bot.process([
      msg(5, "x", { chat: 1, from: 1 }),
      msg(9, "y", { chat: 1, from: 1 }),
    ]),
  ).toBe(10);
  expect(await bot.process([])).toBeUndefined();
});

test("polling asks for new messages only, resumes from the offset, and stops on abort", async () => {
  const polls: Record<string, unknown>[] = [];
  const controller = new AbortController();
  const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
    if (!String(url).endsWith("/getUpdates"))
      return Response.json({ ok: true, result: true });
    polls.push(JSON.parse(init?.body as string));
    if (polls.length === 2) controller.abort();
    return Response.json({
      ok: true,
      result: polls.length === 1 ? [msg(3, "/help")] : [],
    });
  });
  const bot = createBot({
    token: "1:x",
    chatId: ME,
    handle: async () => "ok",
    logger: { warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    fetchFn,
  });
  await bot.run(controller.signal);
  expect(polls[0]).toMatchObject({ allowed_updates: ["message"], timeout: 30 });
  expect(polls[1]).toMatchObject({ offset: 4 });
});

test("a failed poll is logged without the token and retried after a pause", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const logger = { warn: vi.fn(), error: vi.fn() };
  let calls = 0;
  const fetchFn = vi.fn<typeof fetch>(async () => {
    calls++;
    if (calls === 2) controller.abort();
    return calls === 1
      ? new Response(JSON.stringify({ ok: false, description: "Conflict" }), {
          status: 409,
        })
      : Response.json({ ok: true, result: [] });
  });
  const bot = createBot({
    token: "123456:secret-token",
    chatId: ME,
    handle: async () => "ok",
    logger: logger as unknown as Logger,
    fetchFn,
  });
  const done = bot.run(controller.signal);
  await vi.advanceTimersByTimeAsync(2_000);
  await done;
  vi.useRealTimers();
  expect(calls).toBe(2);
  const err = logger.warn.mock.calls[0]?.[0].err as Error;
  expect(err.message).toBe("telegram getUpdates failed: 409 Conflict");
  expect(err.message).not.toContain("secret-token");
});
