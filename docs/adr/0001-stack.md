# 1. One TypeScript monorepo on one Postgres

Status: accepted

## Context

I want Claude to query my notes and my bank data from tools that run on a home mini PC, and I want the project to stay small enough that one person can run and understand all of it. The host is one machine with 8 GB of RAM and Docker.

## Decision

- TypeScript in strict mode everywhere, in a pnpm workspace: `core`, `mcp-server`, `knowledge-base`, `finance`, `briefing`.
- One Postgres with the pgvector extension holds notes, vectors and transactions. The migrations live in `core`.
- Each module exposes functions from its own package. The MCP server and the briefing call those functions and never query another module's tables.
- The MCP server speaks streamable HTTP (stateless) and stdio.
- Every service runs from one Docker image, started by Docker Compose with a different command.

## Alternatives I did not take

- A separate vector database. It is another service to run, back up and secure, and a few thousand chunks do not need one.
- A second language for the finance code. One language means one toolchain and one set of tests.
- A service per module with its own database. It would give hard boundaries, at the cost of several databases to back up on a small machine.

I did not benchmark these. The choice is about operating cost for one person.

## Consequences

- One backup (`pg_dump`) covers everything, and a restore into a scratch database checks it.
- The "functions, not tables" rule is a convention. Nothing enforces it except review, and the notes section of the briefing needed a new function in `knowledge-base` instead of a query.
- Workspace packages resolve to their built `dist`, so a stale build gives errors like "is not a function". Run `pnpm -r build` after changing a package another one imports.
- There is one host and no failover. A dead disk loses the data, because the backups are on the same disk.
