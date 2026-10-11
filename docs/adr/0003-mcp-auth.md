# 3. Bearer tokens and a Host allowlist for the MCP server

Status: accepted

## Context

The MCP server exposes my notes and my bank data to anything that can reach it, and it listens on the home LAN so Claude Code on my laptop can connect. There is one user.

## Decision

- Every request to the HTTP transport needs `Authorization: Bearer <token>`.
- Tokens come from `MCP_AUTH_TOKENS`, comma-separated, so a new one can be added before the old one is removed. A token is hashed with SHA-256 and compared with `timingSafeEqual`, so the compare takes constant time and both buffers have equal length.
- A Host header allowlist (`MCP_ALLOWED_HOSTS`) rejects requests for any other name, which blocks DNS rebinding from a web page.
- The server is published only on the address in `MCP_PUBLISH_ADDR`, and the firewall allows its port. Config errors name a variable and never print its value.
- The HTTP transport is stateless, so there is no session to hijack.

## Alternatives I did not take

- OAuth. It suits many users and third-party clients, and is a lot of machinery for one person and one client that can send a header.
- Mutual TLS. Strong, but certificate handling would be most of the work.
- No auth, relying on the LAN. Anything on the network, including a guest's phone, could then read my transactions.

## Consequences

- Rotation is an edit to `.env` and a restart.
- Any valid token can call every tool, including the rule-editing ones. Those can only change categories, which limits the damage.
- Traffic is plain HTTP on the LAN, so a person on the network could read it. TLS or a Tailscale-only bind is the fix for a production version.
- Docker publishes ports around ufw's normal rules, so the host needs a `DOCKER-USER` rule for each published port. A scan from another machine, not from the host, is the test.
