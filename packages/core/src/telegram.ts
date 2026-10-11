// Plain text, no parse_mode, so nothing in the message can break formatting.
// Errors carry Telegram's description only: the URL holds the bot token.
export function createTelegramSender(opts: {
  token: string;
  chatId: string;
  fetchFn?: typeof fetch;
}) {
  const doFetch = opts.fetchFn ?? fetch;
  return async (text: string): Promise<void> => {
    const res = await doFetch(
      `https://api.telegram.org/bot${opts.token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: opts.chatId,
          text: text.slice(0, 4000),
        }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        description?: string;
      };
      throw new Error(
        `telegram send failed: ${res.status} ${body.description ?? ""}`.trim(),
      );
    }
  };
}
