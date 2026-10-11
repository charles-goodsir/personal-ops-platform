# Personal Ops Platform

A self-hosted personal platform on my home mini PC. It has a shared Postgres + pgvector data layer and an MCP server, so Claude can search my notes and query my finances, and a Telegram bot sends me a daily briefing.

Status: Phase 2 complete (knowledge base). Next is Phase 3, the finance agent. See [docs/brief.md](docs/brief.md) for the full plan.

## What works now

- Claude connects to the MCP server over streamable HTTP (bearer token) or stdio.
- My notes folder (Markdown, text and PDF) is indexed automatically and kept in sync as files change.
- Claude can search my notes and answer from them, citing the file and heading each passage came from.
- Embeddings run locally with Ollama, so note text never leaves the mini PC.

## MCP tools

| Tool                         | What it does                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `ping`                       | Health check, including whether the database is reachable                    |
| `search_notes(query, limit)` | Semantic search. Returns passages with file path, heading, note id and score |
| `get_note(id)`               | Full text of one note (truncated past 50,000 characters)                     |
| `list_recent_notes(n)`       | Most recently modified notes, newest first                                   |

All tools are read-only.

## Services (Docker Compose)

| Service          | Role                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `db`             | Postgres 17 with pgvector. Published on 127.0.0.1 only                                  |
| `migrate`        | One-shot: runs the SQL migrations, then exits                                           |
| `ollama`         | Embeddings model server (`nomic-embed-text`). No published port                         |
| `ollama-pull`    | One-shot: downloads the model into a volume, then exits                                 |
| `knowledge-base` | Scans the notes folder at startup, watches it for changes, and rescans every 15 minutes |
| `mcp-server`     | The MCP server. Published on the address set by `MCP_PUBLISH_ADDR`                      |

`mcp-server` and `knowledge-base` run from one image as a non-root user, with a read-only filesystem, all capabilities dropped and `no-new-privileges`. The notes folder is mounted read-only.

## Setup

1. Install Docker with Compose.
2. Clone the repo and `cp .env.example .env`.
3. Fill in `.env`: a Postgres password, and `MCP_AUTH_TOKENS` (generate one with `openssl rand -hex 32`).
4. Set `NOTES_DIR` to your notes folder. It defaults to `./notes`, which git ignores.
5. On the mini PC, set `MCP_PUBLISH_ADDR` and `MCP_ALLOWED_HOSTS` to its LAN IP, and allow the port through the firewall.
6. `docker compose up -d --build`. The first run downloads the model (about 274 MB) and indexes every note.
7. Add the server to Claude Code: `claude mcp add --scope user --transport http personal-ops-lan http://<host>:3000/mcp --header "Authorization: Bearer <token>"`

For development: `corepack pnpm install`, then `corepack pnpm test`. Integration tests run against Postgres when `DATABASE_URL` is set, in a throwaway schema.

## Security notes

- Bearer tokens are hashed before a constant-time compare. `MCP_AUTH_TOKENS` takes several tokens so one can be rotated in before the old one is removed.
- A Host header allowlist protects against DNS rebinding.
- gitleaks runs as a pre-commit hook and again in CI. CI actions are pinned by commit SHA, and images by digest.
- CI pulls its Postgres image from a GHCR copy (same digest as Docker Hub's), because Docker Hub rate-limited and timed out on GitHub's runners.

## Known limits

- Traffic between Claude and the mini PC is plain HTTP on the home LAN. TLS or a Tailscale-only bind would be the production fix.
- On Docker Desktop for Mac, deleting a note doesn't reach the container, so the 15-minute rescan removes it. The mini PC's native Linux mount sees deletes straight away.
- The first index runs on CPU: 102 notes took about 25 minutes. Later scans skip unchanged files.
- Deleting the last note leaves it in the index. An empty folder looks like a missing mount, so the scan keeps the index rather than wiping it.
- Scanned PDFs with no text layer aren't indexed (no OCR).
