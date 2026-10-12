# Ideas

Improvements to consider later. Logged here rather than built.

- `add_note` MCP tool so Claude can save a note into the knowledge base from any chat. Needs write access to the notes folder and some guard against Claude overwriting my own notes.
- Treat reversed direct debits ("Reversed Dr DD NOT PAID") as cancelling the original, so a failed-then-retried bill doesn't look like two charges.
- Subscription price change alerts: a recurring charge whose amount steps up.
- An outside dead-man's switch: a ping the mini PC sends on a schedule to a service that alerts when it stops. Covers the bot or Telegram being down, which the watchdog can't.
- Lower the log level of the Telegram long-poll ECONNRESET warnings, which are retried and harmless.
- Off-box backups, encrypted, to a second machine or cloud storage. The nightly dumps share the database's disk.
- TLS or a Tailscale-only bind for the MCP server, which is plain HTTP on the LAN.
- Free-text questions on the bot, answered by Claude with the read tools only and a daily cap. Needs thought: no human approves each tool call.
- Automated tests for the scheduler and poll loops (`summary-main`, `briefing-main`, `bot-main`).
- Fold the weekly summary into the Monday briefing as one message.
