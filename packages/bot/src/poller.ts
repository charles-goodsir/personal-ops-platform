import { callTelegram, type Logger } from "@ops/core";

export type Update = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number };
  };
};

// Only my own private chat may talk to the bot. In a private chat the chat id
// and the sender id are the same number, so both must match. Groups, channels
// and anyone else are ignored without a reply.
export function isAuthorised(u: Update, chatId: string): boolean {
  const m = u.message;
  // Optional chaining: an update without a chat must be refused, not crash the loop.
  return (
    m !== undefined &&
    m.chat?.type === "private" &&
    String(m.chat.id) === chatId &&
    String(m.from?.id) === chatId
  );
}

// At most `max` messages in any `windowMs`, so a stuck client or a stolen
// token can't hammer the database.
export function createRateLimiter(max: number, windowMs: number) {
  let times: number[] = [];
  return (now: number): boolean => {
    times = times.filter((t) => now - t < windowMs);
    if (times.length >= max) return false;
    times.push(now);
    return true;
  };
}

export type Handler = (text: string) => Promise<string>;

export function createBot(opts: {
  token: string;
  chatId: string;
  handle: Handler;
  logger: Logger;
  fetchFn?: typeof fetch;
  now?: () => number;
}) {
  const { token, chatId, handle, logger } = opts;
  const now = opts.now ?? Date.now;
  const allow = createRateLimiter(10, 60_000);
  const reply = (text: string) =>
    callTelegram({
      token,
      method: "sendMessage",
      body: { chat_id: chatId, text: text.slice(0, 4000) },
      fetchFn: opts.fetchFn,
    });

  // Handles a batch and returns the offset to ask for next. Strangers get no
  // reply and only a count in the log, never their text.
  async function process(updates: Update[]): Promise<number | undefined> {
    let ignored = 0;
    for (const u of updates) {
      try {
        const text = u.message?.text;
        if (!isAuthorised(u, chatId)) {
          ignored++;
          continue;
        }
        if (!text) continue;
        if (!allow(now())) {
          logger.warn("rate limit reached, message dropped");
          continue;
        }
        try {
          await reply(await handle(text));
        } catch (err) {
          logger.error({ err }, "bot command failed");
          await reply("Something went wrong.").catch(() => {});
        }
      } catch (err) {
        // A malformed update is skipped, so it can't be fetched again for ever.
        logger.warn({ err }, "update skipped");
      }
    }
    if (ignored > 0)
      logger.warn({ ignored }, "ignored messages from other chats");
    const ids = updates.map((u) => u.update_id).filter(Number.isInteger);
    return ids.length ? Math.max(...ids) + 1 : undefined;
  }

  async function run(signal: AbortSignal) {
    let offset: number | undefined;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const updates = await callTelegram<Update[]>({
          token,
          method: "getUpdates",
          body: { offset, timeout: 30, allowed_updates: ["message"] },
          fetchFn: opts.fetchFn,
          signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
        });
        failures = 0;
        offset = (await process(updates)) ?? offset;
      } catch (err) {
        if (signal.aborted) return;
        failures++;
        logger.warn({ err, failures }, "telegram poll failed");
        const wait = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  return { process, run };
}
