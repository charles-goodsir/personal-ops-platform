# Personal Ops Platform

A self-hosted personal platform on my home mini PC. It has a shared Postgres + pgvector data layer and an MCP server, so Claude can search my notes and query my finances, and a Telegram bot sends me a weekly spending summary. A daily briefing is planned.

Status: Phases 1 to 3 complete (foundation, knowledge base, finance agent). Next is Phase 4, the daily briefing. See [docs/brief.md](docs/brief.md) for the full plan.

## What works now

- Claude connects to the MCP server over streamable HTTP (bearer token) or stdio.
- My notes folder (Markdown, text and PDF) is indexed automatically and kept in sync as files change. Claude can search it and answer from it, citing the file and heading each passage came from.
- Embeddings run locally with Ollama, so note text never leaves the mini PC.
- Bank transactions sync from Akahu (NZ open banking) every 6 hours. My own rules categorise them first and Claude Haiku categorises the rest.
- Claude can answer questions like "how much did I spend on groceries last month", list my recurring charges, and look up transactions.
- Every Monday at 08:00 NZ time a summary of the week's spending arrives on Telegram.

## MCP tools

| Tool                                       | What it does                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `ping`                                     | Health check, including whether the database is reachable                                                                     |
| `search_notes(query, limit)`               | Semantic search. Returns passages with file path, heading, note id and score                                                  |
| `get_note(id)`                             | Full text of one note (truncated past 50,000 characters)                                                                      |
| `list_recent_notes(n)`                     | Most recently modified notes, newest first                                                                                    |
| `get_spending(period or dates, category?)` | Spending by category for a period (NZ calendar), plus income and money invested. Transfers and investments are reported apart |
| `list_subscriptions(include_inactive)`     | Recurring charges with cadence, typical amount and next expected date                                                         |
| `get_transactions(filters)`                | Transactions, newest first, filtered by period, category, text and amount. Digits in descriptions are masked                  |
| `add_category_rule(pattern, category)`     | Always put matching transactions into a category. Overrides the model                                                         |
| `list_category_rules()`                    | Rules with how many transactions each matches                                                                                 |
| `remove_category_rule(pattern)`            | Delete a rule. Its transactions go back to the model                                                                          |

Only the two rule-editing tools change data, and they can only change categories: no deletes, nothing sent anywhere, every change logged and reversible. That limit matters because transaction descriptions are partly written by whoever pays me, so text Claude reads from them is untrusted.

## Services (Docker Compose)

| Service          | Role                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `db`             | Postgres 17 with pgvector. Published on 127.0.0.1 only                                    |
| `migrate`        | One-shot: runs the SQL migrations, then exits                                             |
| `ollama`         | Embeddings model server (`nomic-embed-text`). No published port                           |
| `ollama-pull`    | One-shot: downloads the model into a volume, then exits                                   |
| `backup`         | Dumps the database at startup and nightly at 03:00 NZ time, keeping 14 days               |
| `knowledge-base` | Scans the notes folder at startup, watches it for changes, and rescans every 15 minutes   |
| `finance`        | Syncs accounts and transactions from Akahu at startup and every 6 hours, then categorises |
| `summary`        | Sends the weekly spending summary to Telegram, Monday 08:00 NZ time                       |
| `mcp-server`     | The MCP server. Published on the address set by `MCP_PUBLISH_ADDR`                        |

The app services run from one image as a non-root user, with a read-only filesystem, all capabilities dropped and `no-new-privileges`. The notes folder is mounted read-only.

## What leaves the mini PC

| Data                                        | Goes to                       | What is sent                                                                                                                                |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes                                       | Nowhere                       | Embedded locally with Ollama                                                                                                                |
| Transactions, for categorisation            | Claude API (Haiku)            | Masked description, amount, type, and Akahu's merchant and category names. No account numbers or account names                              |
| Weekly summary                              | Claude API (Sonnet), Telegram | Totals, category sums, and a few payee names with digits masked. No transaction rows or descriptions. The finished message goes to Telegram |
| Anything Claude reads through the MCP tools | The Claude chat I'm using     | What the tool returns, with digits masked in descriptions                                                                                   |

Account numbers and holder names are kept out by construction: the Akahu parser never reads them, and the table has no column for them. The `meta` block is not parsed at all, because it carries other people's account numbers.

## Setup

1. Install Docker with Compose.
2. Clone the repo and `cp .env.example .env`. Keep `.env` at `chmod 600`.
3. Fill in `.env`: a Postgres password, and `MCP_AUTH_TOKENS` (generate one with `openssl rand -hex 32`).
4. Create the backups folder as your user, `mkdir backups`, so Docker doesn't create it owned by root. Set `NOTES_DIR` to your notes folder. It defaults to `./notes`, which git ignores.
5. For finance, add the Akahu app and user tokens (my.akahu.nz, personal app). Add an `ANTHROPIC_API_KEY` to categorise with the model. Without one, sync and rules still work and new transactions stay uncategorised.
6. For the Telegram summary, create a bot with @BotFather, send it a message, and read your chat id from the bot's `getUpdates`. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. `CLAUDE_SUMMARY_MODEL` defaults to `claude-sonnet-5-5`.
7. On the mini PC, set `MCP_PUBLISH_ADDR` and `MCP_ALLOWED_HOSTS` to its LAN IP, and allow the port through the firewall.
8. `docker compose up -d --build`. The first run downloads the model (about 274 MB), indexes every note and syncs transactions from `FINANCE_HISTORY_START`.
9. Add the server to Claude Code: `claude mcp add --scope user --transport http personal-ops-lan http://<host>:3000/mcp --header "Authorization: Bearer <token>"`

For development: `corepack pnpm install`, then `corepack pnpm test`. Integration tests run against Postgres when `DATABASE_URL` is set, in a throwaway schema built from the real migrations.

To send a summary now, run `docker compose exec summary node packages/finance/dist/summary-main.js --once`.

## Backups

`backup` writes `pg_dump -Fc` files to `BACKUP_DIR` (default `./backups`, git-ignored) as the host user, readable only by that user. Set `BACKUP_UID` and `BACKUP_GID` from `id -u` and `id -g`.

Restore into a scratch database to check a dump, or into the real one to recover:

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_check'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner' < backups/<file>.dump
```

The backups sit on the same disk as the database, so they cover mistakes and corruption, not a dead disk.

## Security notes

- Bearer tokens are hashed before a constant-time compare. `MCP_AUTH_TOKENS` takes several tokens so one can be rotated in before the old one is removed.
- A Host header allowlist protects against DNS rebinding.
- gitleaks runs as a pre-commit hook and again in CI. CI actions are pinned by commit SHA, and images by digest.
- CI pulls its Postgres image from a GHCR copy (same digest as Docker Hub's), because Docker Hub rate-limited and timed out on GitHub's runners.
- Descriptions are masked before they leave the box: runs of 6 or more digits become `[number]`, and anything after the bank's own run of asterisks becomes `[card]`. A test checks the weekly summary's digest contains no account name, card number or description text.
- The category list is a real `enum` in the JSON schema sent to the API. The SDK's zod helper turned it into a description, so the schema is written by hand and a test checks the MCP tools carry the enum too.
- Config errors name the variable and never print its value, including the Telegram token and chat id. Telegram send errors carry Telegram's description only, because the request URL contains the token.

## Known limits

- The Claude API key expires on 1 January 2027. When it does, transactions keep syncing and rules keep working, but new transactions stay uncategorised, and the weekly summary falls back to plain numbers, until the key is replaced.
- Names in person-to-person payments are sent to the model as written, both for categorisation and as payee names in the weekly summary.
- A closed credit card is not returned by Akahu's API yet, so its history is missing.
- Transactions older than `FINANCE_HISTORY_START` (default 2026-01-01) are not kept. Moving it later deletes older local copies on the next sync.
- Recurring-charge and anomaly detection are plain heuristics with fixed thresholds. They are tuned on one person's data.
- A failed summary send is retried every hour and only logged. Nothing alerts me.
- Traffic between Claude and the mini PC is plain HTTP on the home LAN. TLS or a Tailscale-only bind would be the production fix.
- The mini PC has no disk encryption, and SSH password login is left on (LAN-only firewall rule and fail2ban). Both are accepted for now and worth revisiting now that bank data lives there.
- On Docker Desktop for Mac, deleting a note doesn't reach the container, so the 15-minute rescan removes it. The mini PC's native Linux mount sees deletes straight away.
- The first index runs on CPU: 102 notes took about 25 minutes. Later scans skip unchanged files.
- Deleting the last note leaves it in the index. An empty folder looks like a missing mount, so the scan keeps the index rather than wiping it.
- Scanned PDFs with no text layer aren't indexed (no OCR).
