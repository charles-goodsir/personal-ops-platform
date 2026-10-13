# 11. Budgets and a read-only dashboard

Status: accepted

## Context

I can ask for spending in chat, but nothing tells me when a category is running away, and nothing lets me see the month at a glance. I want monthly limits per category with an alert, and a page that shows spending against those limits, subscriptions and job health. The dashboard is a new web entry point on a box that holds my bank data, so it needs a threat model entry before it is built.

## Decision

- **Budgets are per category, monthly.** One row per category in a `budgets` table. I set them from the bot with `/budget set <category> <amount>`, and the category is checked against the same list the rest of the system uses. No MCP tool can change a budget, so the write surface from [ADR 5](0005-finance-privacy.md) does not grow.
- **Alerts run after each finance sync.** One message when a category passes 80% of its limit and one at 100%, each at most once per category per month. The sent state lives in the database, so a restart does not repeat a message. The sync is daily at 08:00, so an alert can arrive up to a day after the spending that caused it.
- **The briefing gets a Budgets section.** It reuses the same status code as the alert and the dashboard.
- **The dashboard is a separate `dashboard` service on `node:http`.** No framework, no client JavaScript, no CDN. Charts are inline SVG built on the server.
- **Access is an SSH tunnel only.** The port is published on `127.0.0.1` on the mini PC. A password is still required (constant-time compare), and the `Host` header is checked against an allowlist.
- **Read-only is enforced twice.** The server answers only `GET`, and every connection switches to a Postgres role (`dashboard_ro`) that has `SELECT` on the four tables the page needs and nothing else. It is a `NOLOGIN` role that the connection takes on at startup (`-c role=dashboard_ro`), so it needs no second password. A test shows `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` and `CREATE` all fail, and so does reading the notes and rules tables.
- **Everything shown is escaped and masked.** Payee names are written by whoever pays me, so they are HTML-escaped on output and pass through the same digit masking as the tools.

## Alternatives I did not take

- **Serve the dashboard on the LAN.** It is easier to reach, and the password would cross the network in plain HTTP. The tunnel is one command.
- **A login role with its own password.** It is stronger, because the service could never switch back to my own role. It needs a password created outside the migrations and a second secret in `.env`. The role switch can only be undone by running arbitrary SQL, and the dashboard runs fixed queries. I would move to a login role if the dashboard ever takes input into a query.
- **Rely on the server code for read-only.** A bug in a route could then write. A database role cannot be talked out of it.
- **A charting library or a web framework.** Faster to build, and it adds dependencies and a supply chain to a service that shows bank data.
- **MCP tools to set budgets.** It would let Claude change limits. I would rather the only writer be my own chat.
- **Real-time alerts.** They need syncing more often, which means more Akahu calls for a limit I only need to know about by the next morning.
- **An overall monthly total.** Easy to add later. Per-category limits answer the question I have.

## Consequences

- A new service, a new table, a new database role and a new password in `.env` to protect.
- An alert can be a day late. The ADR says so and the message shows the date of the last sync.
- If the password leaks, someone on the tunnel can read my spending, but cannot write and cannot reach anything outside `GET`.
- The tunnel means the dashboard is not available from my phone. That is the price of not exposing it.
- The [threat model](../threat-model.md) now has section D for the dashboard and the budget commands, with attack tests to run before the dashboard is deployed.
