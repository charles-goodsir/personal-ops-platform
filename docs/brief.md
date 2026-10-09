# Project 1: Personal Ops Platform

> **Build order:** This is project 1 of 2. Build this first. Project 2 (`02-security-mcp-server.md`) reuses the MCP scaffolding from this project and must not start until this one is complete.

## Goal

A self-hosted personal platform with a shared data layer and an MCP server, so Claude can query my notes and finances, and I get a daily briefing on Telegram. It runs on my home mini PC.

It needs to be useful to me day to day and work as a portfolio piece, so code quality, tests, and documentation matter as much as features.

## Constraints

- **Host:** mini PC on my home network (Linux Mint, Docker + Docker Compose already installed, SSH key auth, ufw, fail2ban). Default host IP `192.168.88.13`, keep it configurable.
- **Language:** TypeScript (Node.js) throughout unless there's a strong reason otherwise. Ask before introducing another language.
- **Deployment:** everything runs through `docker compose up -d --build`.
- **Secrets:** `.env` file only, never committed. Add `.env.example` with placeholders. Add a gitleaks pre-commit hook.
- **LLM:** Claude API. Model names live in config, not hardcoded. Use a cheaper model for bulk work (categorisation) and a stronger one for summaries.
- **Scope discipline:** each module is done once it works for me. Log improvement ideas in `IDEAS.md` instead of building them.

## Architecture

```
┌──────────────────────────── mini PC (Docker Compose) ────────────────────────────┐
│                                                                                  │
│  Postgres + pgvector  ◄──  core (shared data layer, migrations, types)           │
│         ▲                         ▲              ▲              ▲                │
│         │                         │              │              │                │
│   mcp-server              knowledge-base     finance        briefing             │
│   (tools for Claude)      (ingest + search)  (Akahu sync)   (scheduler + bot)    │
│                                                                  │               │
└──────────────────────────────────────────────────────────────────┼───────────────┘
                                                                   ▼
                                                               Telegram
```

Monorepo layout (pnpm workspaces or similar):

```
/packages/core            shared DB client, schema, migrations, types, config
/packages/mcp-server      MCP server exposing tools from every module
/packages/knowledge-base  ingestion, chunking, embeddings, search
/packages/finance         Akahu sync, categorisation, summaries
/packages/briefing        scheduled jobs, Telegram delivery
/docs                     architecture diagram, ADRs, setup guide
docker-compose.yml
```

Every module exposes its capabilities as functions in its own package. The MCP server and the briefing call those functions; they don't touch module tables directly.

## Phases

### Phase 1: Foundation (1 to 2 weeks)

- Monorepo setup, linting, formatting, TypeScript strict mode
- Postgres with pgvector in Docker Compose, migration tooling
- `core` package: DB client, config loading with validation, logging
- MCP server skeleton with one `ping` tool, runnable over stdio and streamable HTTP
- Token auth on the HTTP transport
- GitHub Actions: lint, typecheck, test, gitleaks
- **Done when:** `docker compose up` starts DB + MCP server, and Claude can call `ping`.

### Phase 2: Knowledge base (2 weeks)

- Ingest Markdown, plain text, and PDF from a watched folder
- Chunk, embed, and store in pgvector. Propose an embedding option (hosted vs local model on the mini PC) with trade-offs before implementing.
- Re-ingest on file change, delete on file removal
- MCP tools: `search_notes(query, limit)`, `get_note(id)`, `list_recent_notes(n)`
- **Done when:** I can ask Claude a question in a chat and it answers from my own notes with source references.

### Phase 3: Finance agent (2 to 3 weeks)

- Akahu API integration (NZ open banking) using personal app tokens. Check onboarding requirements first and tell me if anything blocks this.
- Daily transaction sync, idempotent, with deduplication
- Categorisation via Claude, with a rules table I can edit that overrides the model
- Detect recurring charges and subscriptions, flag unusual transactions
- Weekly summary: spend by category vs previous weeks, new subscriptions, anomalies
- MCP tools: `get_spending(period, category?)`, `list_subscriptions()`, `get_transactions(filters)`
- **Done when:** a weekly summary lands on Telegram and Claude can answer "how much did I spend on X last month".

### Phase 4: Daily briefing (1 week)

- Scheduler (cron-style, in-container) with a configurable time
- Telegram bot for delivery
- Briefing sections are pluggable modules: finance snapshot, recently added notes, weather, plus room to add more later
- A failing section should be skipped and logged, not kill the whole briefing
- **Done when:** a morning message arrives every day with all sections.

### Phase 5: Polish (1 to 2 weeks)

- README: what it is, why, architecture diagram, setup in under 10 steps, screenshots
- ADRs in `/docs` for key decisions (stack, embeddings, auth, data model)
- Test coverage on core logic (categorisation rules, dedupe, chunking, briefing assembly)
- Script and record a short demo video
- **Done when:** a stranger can read the README and understand what it does and how it's built in 2 minutes.

## Data handling

- Financial data stays on the mini PC. Only the minimum needed goes to the Claude API (descriptions and amounts for categorisation, aggregates for summaries).
- No account numbers in logs or prompts.
- Back up the Postgres volume nightly to a local folder.

## Working style

- Work one phase at a time. Confirm the plan for each phase with me before writing code.
- Small commits with clear messages.
- When a decision has real trade-offs, give me the options and a recommendation instead of choosing silently.
- Write copy (README, docs) without em dashes.
