// One place that talks to the Telegram Bot API. The URL holds the bot token,
// so errors carry Telegram's description only, never the URL.
export async function callTelegram<T = unknown>(opts: {
  token: string;
  method: string;
  body: unknown;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<T> {
  const doFetch = opts.fetchFn ?? fetch;
  const res = await doFetch(
    `https://api.telegram.org/bot${opts.token}/${opts.method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!res.ok || json.ok === false) {
    throw new Error(
      `telegram ${opts.method} failed: ${res.status} ${json.description ?? ""}`.trim(),
    );
  }
  return json.result as T;
}

// Plain text, no parse_mode, so nothing in the message can break formatting.
export function createTelegramSender(opts: {
  token: string;
  chatId: string;
  fetchFn?: typeof fetch;
}) {
  return async (text: string): Promise<void> => {
    await callTelegram({
      token: opts.token,
      method: "sendMessage",
      body: { chat_id: opts.chatId, text: text.slice(0, 4000) },
      fetchFn: opts.fetchFn,
    });
  };
}
