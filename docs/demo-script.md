# Demo video: script and shot list

A 3 to 4 minute screen recording for someone who has never seen the project. The goal is the README's goal: after watching, they understand what it does and how it is built. Every scene shows something that really runs, and the privacy scene shows a control failing on purpose.

## Before recording

- Use a fresh Claude Code session, so the MCP tools show as `personal-ops-lan` and the finance tools are listed.
- Notes demo: ask about the OWASP notes, not a private note. They are public portfolio content.
- Bank data: the demo shows category totals only. Before recording, hide account names and any person-to-person payee in frame, or crop them out in editing. Never show a raw transaction list.
- Hide `.env`, tokens and the mini PC's IP address if the terminal prompt shows it.
- Use a large terminal font (at least 18 pt) and a dark theme with high contrast. Record at 1080p.
- Do a dry run first. The Telegram scene needs a real briefing, so use `docker compose exec briefing node packages/briefing/dist/briefing-main.js --once` the morning of, or screenshot the 07:00 message.

## Scenes

| Time | Scene                             | On screen                                                                                                                              | What to say                                                                                                                                                                                                                                         |
| ---- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | What it is                        | README top: the title, "Why I built it" and the diagram                                                                                | "This is a personal platform that runs on a mini PC at home. It lets Claude search my notes and answer questions about my spending, and it sends me a briefing every morning. The point is that my notes and my bank data stay on my own hardware." |
| 0:20 | Notes                             | Claude Code asking: "what did I do about IDOR in the expense claims app?" The answer with its cited file path and heading              | "Claude calls `search_notes`. The notes are embedded locally with Ollama, so the text never leaves the box. It cites the file and heading each passage came from."                                                                                  |
| 1:05 | Finance                           | Ask: "how much did I spend on groceries last month?" Then: "list my subscriptions"                                                     | "Transactions sync from Akahu every six hours. My own rules categorise first and a small model does the rest. Spending leaves out transfers and investments, so the totals mean something."                                                         |
| 1:35 | The write tools                   | Ask: "list my category rules". Point at the tool list                                                                                  | "Only two tools change data, and they can only change categories. Payment references are text written by whoever pays me, so I treat anything Claude reads from them as untrusted. The worst it can do through a tool is set a category."           |
| 2:05 | A control, broken on purpose      | The failing test: the summary tests with the payee masking removed (two FAIL lines), then the README's "What leaves the mini PC" table | "Only masked text and totals go to the Claude API. Here I removed the masking on purpose and the tests fail. Real data taught me this: the bank had masked a card number, but my mask let the last four digits through."                            |
| 2:45 | The morning briefing              | The Telegram message on a phone: Finance, Notes and Weather                                                                            | "Every morning at seven I get this. It is plain code, no model. If one section fails, it says unavailable and the rest still arrive."                                                                                                               |
| 3:15 | How it is built, and what is next | `docker compose ps` with eight services up, then the `docs/adr` folder                                                                 | "Eight running services in Docker Compose, one Postgres, six written-down design decisions. For production I would add TLS or a Tailscale-only bind, disk encryption, off-box backups, and alerts when a sync or backup fails."                             |

Total: about 3 minutes 35 seconds.

## What to capture, and what to protect

| Scene          | Capture                                                                                                                                                                                                          | Protect                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Notes          | The full answer with the path and heading visible                                                                                                                                                                | Nothing, if you stay on the OWASP notes                                           |
| Finance        | The grocery total and the top payees                                                                                                                                                                             | Account names, any person's name                                                  |
| Write tools    | The tool list including `add_category_rule`                                                                                                                                                                      | Nothing                                                                           |
| Broken control | Run `corepack pnpm exec vitest run packages/finance/src/summary.test.ts` after removing `maskDigits(...)` from the unusual-charge payee in `summary.ts`. Capture the two FAIL lines, then `git restore` the file | Do this on a branch with a clean tree, and restore before recording anything else |
| Briefing       | The whole message                                                                                                                                                                                                | Payee names and amounts, if you want them private                                 |
| Services       | `docker compose ps` on the mini PC                                                                                                                                                                               | The IP address in the prompt                                                      |

## If asked afterwards

- "Has it caught a real mistake?" The enum the SDK turned into a description, and the card digits behind the bank's own mask. Both appeared only on real data.
- "How do you know the controls work?" I break them on purpose and watch a test fail.
- "What would you change for production?" TLS or Tailscale, disk encryption, off-box backups, OAuth if there were more than one user, and monitoring that alerts me instead of me reading logs.
