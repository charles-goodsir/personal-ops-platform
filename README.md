# Personal Ops Platform

A self-hosted personal platform on my home mini PC. It has a shared Postgres + pgvector data layer and an MCP server, so Claude can search my notes and query my finances, and a Telegram bot sends me a daily briefing and a weekly spending summary, and answers a few commands.

Status: complete and running on my mini PC: foundation, knowledge base, finance agent, daily briefing, command bot, status alerts with an outside check, and a daily diary message. See [docs/brief.md](docs/brief.md) for the full plan and the [risk assessment](RISK_ASSESSMENT.md) for what could go wrong and what I accepted.

## Why I built it

I wanted Claude to answer from my own notes and my own bank data, and I did not want either handed over wholesale to a hosted service. So the data lives in Postgres on a mini PC at home, the search runs there, and only the minimum goes to the Claude API: masked descriptions and amounts to categorise a transaction, and totals to write a weekly summary. Notes are embedded locally and never leave.

It is also a portfolio project, so each step is its own pull request with tests, and the controls are proven by breaking them on purpose and watching a test fail.

## How it fits together

```mermaid
flowchart LR
  subgraph home["Mini PC (Docker Compose)"]
    kb["knowledge-base"]
    ollama["Ollama (embeddings)"]
    fin["finance"]
    db[("Postgres + pgvector")]
    mcp["mcp-server"]
    brief["briefing"]
    sum["summary"]
    diary["diary"]
    backup["backup (nightly pg_dump)"]
    bot["bot (commands, watchdog)"]
    notes[/"Notes folder"/]
  end
  akahu["Akahu (bank data)"] --> fin
  notes --> kb
  kb <--> ollama
  kb --> db
  fin --> db
  fin -- "masked text" --> api["Claude API"]
  db --> mcp
  db --> brief
  db --> sum
  db --> backup
  sum -- "aggregates only" --> api
  weather["Open-Meteo"] -- "coordinates only" --> brief
  mcp -- "bearer token, LAN" --> claude["Claude Code"]
  db --> bot
  bot <-- "polls and replies" --> tg["Telegram"]
  brief --> tg
  sum --> tg
  diary --> tg
  gh["GitHub (my public portfolio repo)"] -- "reads diary entries" --> diary
  bot -- "ping every 5 min, no data" --> hc["Healthchecks.io"]
```

Each module exposes functions from its own package. The MCP server, the briefing and the summary call those functions and never read another module's tables. The [design decisions](#design-decisions) below explain the choices that shaped this.

## What works now

- Claude connects to the MCP server over streamable HTTP (bearer token) or stdio.
- My notes folder (Markdown, text and PDF) is indexed automatically and kept in sync as files change. Claude can search it and answer from it, citing the file and heading each passage came from.
- Embeddings run locally with Ollama, so note text never leaves the mini PC.
- Bank transactions sync from Akahu (NZ open banking) every 6 hours. My own rules categorise them first and Claude Haiku categorises the rest.
- Claude can answer questions like "how much did I spend on groceries last month", list my recurring charges, and look up transactions.
- Every morning at 07:00 NZ time a briefing arrives on Telegram: yesterday's spending and any unusual charge, notes that changed in the last day, and today's weather. A section that fails is skipped and shown as unavailable, and the rest still send.
- Every morning at 07:05 NZ time a second message lists the previous day's diary entries (title and bullets), and nothing arrives on a day with no entry.
- Every Monday at 08:00 NZ time a summary of the week's spending arrives on Telegram as a separate message.
- I can message the bot from my own Telegram chat and get answers back: spending, subscriptions, matching notes, or the briefing on demand. See [Telegram commands](#telegram-commands).

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

## Telegram commands

Send these to the bot from my own private chat. Every other chat is ignored with no reply.

| Command                      | What it does                                                            |
| ---------------------------- | ----------------------------------------------------------------------- |
| `/spend [period] [category]` | Spending by category, default this month. `/spend last month groceries` |
| `/subs [all]`                | Active recurring charges, or all of them                                |
| `/notes <words>`             | Titles and paths of matching notes. Never note text                     |
| `/briefing`                  | Sends the daily briefing now                                            |
| `/status`                    | When each job last succeeded, and which are stale                       |
| `/help`                      | Lists the commands, periods and categories                              |

The commands are read-only and use no model. Arguments must match the period names and the category list, and nothing is passed on as free text. See [the ADR](docs/adr/0007-telegram-command-bot.md) for the allowlist, the rate limit and what I left out.

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
| `bot`            | Polls Telegram for my commands and answers them, and runs the watchdog. Outbound only     |
| `briefing`       | Sends the daily briefing to Telegram at `BRIEFING_TIME` (default 07:00 NZ time)           |
| `diary`          | Sends yesterday's diary entries to Telegram at `DIARY_TIME` (default 07:05 NZ time)       |
| `summary`        | Sends the weekly spending summary to Telegram, Monday 08:00 NZ time                       |
| `mcp-server`     | The MCP server. Published on the address set by `MCP_PUBLISH_ADDR`                        |

The app services run from one image as a non-root user, with a read-only filesystem, all capabilities dropped and `no-new-privileges`. The notes folder is mounted read-only.

## What leaves the mini PC

| Data                                        | Goes to                       | What is sent                                                                                                                                |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes                                       | Nowhere                       | Embedded locally with Ollama                                                                                                                |
| Transactions, for categorisation            | Claude API (Haiku)            | Masked description, amount, type, and Akahu's merchant and category names. No account numbers or account names                              |
| Weekly summary                              | Claude API (Sonnet), Telegram | Totals, category sums, and a few payee names with digits masked. No transaction rows or descriptions. The finished message goes to Telegram |
| Weather                                     | Open-Meteo                    | Latitude and longitude only (suburb level). No key, no account                                                                              |
| Telegram commands                           | Telegram                      | My question, and the answer: totals, subscription lines, and note titles and paths. No transaction lines or note text                       |
| Heartbeat ping                              | Healthchecks.io               | An empty request every 5 minutes. It tells them the box is up, and carries no data                                                          |
| Diary entries                               | GitHub (reads)                | A request for one public file, with no credentials. My text comes in, nothing goes out                                                      |
| Anything Claude reads through the MCP tools | The Claude chat I'm using     | What the tool returns, with digits masked in descriptions                                                                                   |

Account numbers and holder names are kept out by construction: the Akahu parser never reads them, and the table has no column for them. The `meta` block is not parsed at all, because it carries other people's account numbers.

## Design decisions

Short records of the choices that shaped the project, with what I rejected and what each costs:

1. [One TypeScript monorepo on one Postgres](docs/adr/0001-stack.md)
2. [Embed notes locally with Ollama](docs/adr/0002-local-embeddings.md)
3. [Bearer tokens and a Host allowlist for the MCP server](docs/adr/0003-mcp-auth.md)
4. [Data model: versioned vectors, and transactions that follow the source](docs/adr/0004-data-model.md)
5. [What leaves the box: masking, aggregates and a small write surface](docs/adr/0005-finance-privacy.md)
6. [A daily briefing built from plain code, and a separate weekly summary](docs/adr/0006-briefing-without-a-model.md)
7. [A Telegram bot that answers fixed commands, for me only](docs/adr/0007-telegram-command-bot.md)
8. [Heartbeats and a watchdog, so a silent failure becomes a message](docs/adr/0008-heartbeats-and-watchdog.md), with an update for the outside check
9. [Yesterday's diary entries as their own morning message](docs/adr/0009-diary-message.md)

## Setup

1. Install Docker with Compose.
2. Clone the repo and `cp .env.example .env`. Keep `.env` at `chmod 600`.
3. Fill in `.env`: a Postgres password, and `MCP_AUTH_TOKENS` (generate one with `openssl rand -hex 32`).
4. Create the backups folder as your user, `mkdir backups`, so Docker doesn't create it owned by root. Set `NOTES_DIR` to your notes folder. It defaults to `./notes`, which git ignores.
5. For finance, add the Akahu app and user tokens (my.akahu.nz, personal app). Add an `ANTHROPIC_API_KEY` to categorise with the model. Without one, sync and rules still work and new transactions stay uncategorised.
6. For the Telegram summary, create a bot with @BotFather, send it a message, and read your chat id from the bot's `getUpdates`. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. `CLAUDE_SUMMARY_MODEL` defaults to `claude-sonnet-5-5`. The daily briefing and the command bot use the same bot and chat. Only the weekly summary uses a model. Set `WEATHER_LAT` and `WEATHER_LON` (suburb level is enough), and optionally `BRIEFING_TIME` (24-hour NZ time, default 07:00) and `DIARY_TIME` (default 07:05). Optionally create a check at healthchecks.io with a 5 minute period and 10 minute grace, add your email as its alert channel, and set `HEALTHCHECK_PING_URL` to its ping URL.
7. On the mini PC, set `MCP_PUBLISH_ADDR` and `MCP_ALLOWED_HOSTS` to its LAN IP, and allow the port through the firewall.
8. `docker compose up -d --build`. The first run downloads the model (about 274 MB), indexes every note and syncs transactions from `FINANCE_HISTORY_START`.
9. Add the server to Claude Code: `claude mcp add --scope user --transport http personal-ops-lan http://<host>:3000/mcp --header "Authorization: Bearer <token>"`

For development: `corepack pnpm install`, then `corepack pnpm test`. Integration tests run against Postgres when `DATABASE_URL` is set, in a throwaway schema built from the real migrations.

To send a summary, briefing or diary message now, run `docker compose exec summary node packages/finance/dist/summary-main.js --once`, `docker compose exec briefing node packages/briefing/dist/briefing-main.js --once` or `docker compose exec diary node packages/briefing/dist/diary-main.js --once` (add `--day=2026-10-12` to choose the day).

## Backups

`backup` writes `pg_dump -Fc` files to `BACKUP_DIR` (default `./backups`, git-ignored) as the host user, readable only by that user. Set `BACKUP_UID` and `BACKUP_GID` from `id -u` and `id -g`.

Restore into a scratch database to check a dump, or into the real one to recover:

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_check'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner' < backups/<file>.dump
```

The backups sit on the same disk as the database, so they cover mistakes and corruption, not a dead disk.

## Security notes

The [risk assessment](RISK_ASSESSMENT.md) lists what I am protecting, what could go wrong, the controls in place, the risks I accepted and what is still open.

- The mini PC runs only what it needs. A port scan from another machine on the LAN finds just SSH (22) and the MCP server (3000). The printing and modem services are disabled, the old build agent's folder is deleted, and unattended upgrades include Ubuntu's security pocket, which Linux Mint's default config misses. Avahi (`.local` names) is left running.

- Bearer tokens are hashed before a constant-time compare. `MCP_AUTH_TOKENS` takes several tokens so one can be rotated in before the old one is removed.
- A Host header allowlist protects against DNS rebinding.
- gitleaks runs as a pre-commit hook and again in CI. CI actions are pinned by commit SHA, and images by digest.
- CI pulls its Postgres image from a GHCR copy (same digest as Docker Hub's), because Docker Hub rate-limited and timed out on GitHub's runners.
- Descriptions are masked before they leave the box: runs of 6 or more digits become `[number]`, and anything after the bank's own run of asterisks becomes `[card]`. A test checks the weekly summary's digest contains no account name, card number or description text.
- The category list is a real `enum` in the JSON schema sent to the API. The SDK's zod helper turned it into a description, so the schema is written by hand and a test checks the MCP tools carry the enum too.
- The command bot answers only my private chat (chat id and sender id must both match), ignores everyone else without replying, handles at most 10 messages a minute, and runs fixed read-only commands with validated arguments. I proved the allowlist live by running a copy with a wrong chat id and getting no reply.
- Each job records a heartbeat in a `job_runs` table (last success and last attempt, no error text). `/status` and a watchdog in the `bot` service share one set of staleness limits, send one alert per incident and one "working again", and carry only the job name and age. I proved it live by backdating a heartbeat and getting the alert, then the all-clear.
- The watchdog's own blind spot is covered from outside. The bot pings Healthchecks.io after each check that worked, and it emails me when the pings stop. No ping is sent if the check itself fails, and the ping URL is a secret that never appears in a log or an error. I proved it by stopping the bot and waiting for the email.
- The diary message reads one fixed public GitHub URL with a timeout and a size cap, and parses the file without running it. A file that parses to nothing is an error that the watchdog turns into an alert.
- Config errors name the variable and never print its value, including the Telegram token and chat id. Telegram send errors carry Telegram's description only, because the request URL contains the token.

## Known limits

- The Claude API key expires on 1 January 2027. When it does, transactions keep syncing and rules keep working, but new transactions stay uncategorised, and the weekly summary falls back to plain numbers, until the key is replaced.
- Names in person-to-person payments are sent to the model as written, both for categorisation and as payee names in the weekly summary.
- Closed accounts are not returned by Akahu's API, so a closed credit card's history is missing and spending on it is not counted. Payments to it count as transfers.
- Transactions older than `FINANCE_HISTORY_START` (default 2026-01-01) are not kept. Moving it later deletes older local copies on the next sync.
- Recurring-charge and anomaly detection are plain heuristics with fixed thresholds. They are tuned on one person's data.
- A failed summary or briefing send is retried every hour. If a job stays stale past its limit, the watchdog messages me once (see [the ADR](docs/adr/0008-heartbeats-and-watchdog.md)). It lives in the `bot` service and sends through Telegram, so an outside check pings Healthchecks.io and emails me if the bot, its database connection or the watchdog loop stops. If Healthchecks is down at the same time as the box, nothing alerts me. The briefing's schedule and retry loop have no automated test, only a manual `--once` run.
- The briefing's notes section reports file modification time, so it can't tell a new note from an edited one. Its finance section can look light if Akahu's daily refresh is late.
- A section that times out keeps running in the background until it finishes. None of the current sections hold a connection open.
- On Mondays the briefing, the diary message and the weekly summary arrive as three separate messages.
- The diary message is only as fresh as my last push to my-portfolio's `main`, and its parser depends on that file's formatting. If the layout changes it fails loudly rather than going quiet.
- The bot token is the real secret for the command bot: whoever holds it can read my messages to it. Telegram sees my questions and the answers, and messages sent while the bot is down are answered when it restarts. Only one copy can poll at a time.
- Traffic between Claude and the mini PC is plain HTTP on the home LAN. TLS or a Tailscale-only bind would be the production fix.
- The mini PC has no disk encryption. Encrypting an existing root disk means a reinstall, and the realistic threat is someone taking a home PC. I accepted that: the Akahu and API tokens can be revoked, `.env` is readable only by its owner, and the backups sit on the same disk. Revisit when the box is next rebuilt.
- SSH password login is left on, restricted to the LAN by the firewall and watched by fail2ban.
- On Docker Desktop for Mac, deleting a note doesn't reach the container, so the 15-minute rescan removes it. The mini PC's native Linux mount sees deletes straight away.
- The first index runs on CPU: 102 notes took about 25 minutes. Later scans skip unchanged files.
- Deleting the last note leaves it in the index. An empty folder looks like a missing mount, so the scan keeps the index rather than wiping it.
- Scanned PDFs with no text layer aren't indexed (no OCR).
