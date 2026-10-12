# 7. A Telegram bot that answers fixed commands, for me only

Status: accepted

## Context

The briefing and the weekly summary only send. I also wanted to ask a question from my phone, such as how much I spent on groceries or which note mentions a topic, and get the answer back. A bot that reads incoming messages is a new way into the system, and what it reads is text anyone could send to a public bot name.

## Decision

- A `bot` service long-polls Telegram's `getUpdates`. The mini PC only makes outbound calls, so no port opens and the firewall is unchanged.
- A message is handled only if it is in a private chat and both the chat id and the sender id equal `TELEGRAM_CHAT_ID`. Groups, other chats and anything that is not a message are ignored with no reply, and the log records a count, never the text.
- At most 10 messages a minute are handled. The rest are dropped and logged.
- Commands are a fixed list: `/spend`, `/subs`, `/notes`, `/briefing`, `/help`. Arguments must match the period names and the category list, and a message over 100 characters is refused. Nothing is passed on as free text.
- Every command is read-only, and no model is involved. `/notes` returns titles and paths, never note text. There is no command for individual transactions.
- Replies are plain text and go to the allowlisted chat only, and they use the same formatting code as the MCP tools.

## Alternatives I did not take

- A webhook. It needs a public address pointing at the mini PC, which is the exposure I have been avoiding.
- Free-text questions answered by Claude with the read tools. It is the nicer interface, but it means a model acting on text that other people wrote (payee names, note titles) with nobody to approve each tool call, plus a bill per question. I would add it later with read-only tools and a daily cap.
- Showing transactions or note text in replies. Totals and titles are less sensitive than lines and paragraphs, and everything in a reply passes through Telegram's servers.
- Replying to strangers with a refusal. A reply confirms the bot exists.

## Consequences

- The bot token is the real secret. Anyone holding it can read my messages to the bot and send as it. It lives in `.env` at mode 600 and can be revoked through BotFather.
- Telegram sees my questions and the answers, which is already true for the briefing.
- Telegram keeps unanswered messages for about a day, so anything sent while the service is down is answered on restart. Every command is read-only, so a replay changes nothing.
- A bot allows one poller at a time. Running a second copy, for example on my laptop, makes both fail with a 409 until one stops. I test with fakes and prove it live on the mini PC.
- I had no second Telegram account, so I proved the allowlist differently: I stopped the real service, ran a copy with a wrong chat id, sent `/spend` from my own chat, and got no reply. The log showed one ignored message and none of its text.
- The rate limit can drop a real message if I send more than ten in a minute.
- The poll loop and `bot-main.ts` have no automated test of their own. The tests cover the allowlist, the limiter, the offset, the retry and the commands with fakes.
