import { expect, test, vi } from "vitest";
import { createTelegramSender } from "./telegram.js";

test("posts plain text to the chat, errors never carry the token", async () => {
  const fetchFn = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ ok: false, description: "chat not found" }),
        { status: 400 },
      ),
  );
  const send = createTelegramSender({
    token: "123456:secret-token",
    chatId: "42",
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  const err = await send("hi").catch((e: Error) => e);
  expect(err).toMatchObject({
    message: "telegram send failed: 400 chat not found",
  });
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/sendMessage");
  expect(JSON.parse(init.body as string)).toEqual({
    chat_id: "42",
    text: "hi",
  });
});

test("cuts text to fit Telegram's 4096-character limit", async () => {
  const fetchFn = vi.fn<typeof fetch>(
    async () => new Response("{}", { status: 200 }),
  );
  const send = createTelegramSender({ token: "1:x", chatId: "42", fetchFn });
  await send("a".repeat(5000));
  const init = fetchFn.mock.calls[0]?.[1];
  expect(JSON.parse(init?.body as string).text).toHaveLength(4000);
});
