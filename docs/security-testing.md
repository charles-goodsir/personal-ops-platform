# Security testing

Status: **plan and harness only. No attack has been run yet.** The threats and their IDs come from the [threat model](threat-model.md). This file is where each test is recorded: what I tried, what should have happened, what did, and what I changed.

## Rules

1. **Local only.** Every attack runs against a local copy of the stack with a throwaway database. The live mini PC gets read-only checks from my laptop (open ports, rejected requests), so the unattended jobs are never at risk.
2. **My own system only.** Nothing here is aimed at anyone else's service. The third parties in the threat model (Telegram, GitHub, Akahu, Anthropic) are trusted and not tested.
3. **A failing test is a finding.** I write each test to assert the secure behaviour. If it fails, that is a bypass: I record it here as it happened, fix the code, and rerun the test until it passes. I do not weaken a test to make it pass.
4. **Where I accept a gap, the test says so.** It asserts the current behaviour and names the decision, so a later change shows up as a failure.
5. **Report the bad results.** A finding that looks embarrassing is still a result.

## How the tests are built

- Attack tests are ordinary vitest tests, so they run in CI as regression tests once they pass. They live next to the code they attack. The HTTP layer ones are in [`packages/mcp-server/src/attack`](../packages/mcp-server/src/attack).
- **`raw.ts`** sends bytes exactly as given over a plain socket, which `fetch()` cannot do: repeated headers, a Host that is not the address, a broken request line. It returns the status, the headers in order and the body, and status 0 if the server sends nothing.
- **`app.ts`** starts the real HTTP app on a random local port with stub dependencies and a logger that keeps its output, so a test can read the logs as well as the reply.
- **`harness.test.ts`** checks the harness itself, so a hostile request that a test claims to send was really sent.
- Tests for the tools (batch B) use the throwaway Postgres schema the other integration tests use. Tests for the bot and the parsers (batch C) call their functions directly.

Run the HTTP layer attacks and the harness checks:

```sh
set -a; . ./.env; set +a
corepack pnpm exec vitest run packages/mcp-server/src/attack
```

## Observations so far

- **Repeated Authorization headers (for A1).** Node's HTTP parser keeps the first copy of a repeated `Authorization` header and drops the rest. A request with a good token first and junk second therefore authenticates, and junk first fails. This is documented Node behaviour and does not weaken the check on its own, because nothing sits in front of the server that could read a different copy. It would matter if I ever put a proxy in front, so batch A records it as a test.

## Results

Result is one of: not run, pass, finding fixed, accepted. Each entry gets the PR that changed the code.

| ID  | Test                                                                        | Expected                                                 | Actual | Result  | Fix |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ------ | ------- | --- |
| A1  | Missing, empty, odd-case, spaced, repeated and very long Authorization      | 401 every time, no detail                                |        | not run |     |
| A2  | Many wrong tokens in a row                                                  | Rejected, and logged so I can see it                     |        | not run |     |
| A3  | Host values: IP forms, ports, trailing dot, uppercase. Origin header        | Rejected unless on the allowlist                         |        | not run |     |
| A4  | Invalid, oversized and deeply nested JSON bodies                            | A clean 4xx, the process stays up                        |        | not run |     |
| A5  | Read every failure response above                                           | No stack trace, path or query                            |        | not run |     |
| A6  | A burst of requests (local copy only)                                       | It keeps answering. Decide if a limit is needed          |        | not run |     |
| A7  | GET, PUT, DELETE and OPTIONS on `/mcp`                                      | 405                                                      |        | not run |     |
| A8  | Decision: an audit log of tool calls                                        | Written down in an ADR, either way                       |        | not run |     |
| A9  | Decision: per-tool token scopes                                             | Written down in an ADR, either way                       |        | not run |     |
| B1  | SQL injection payloads in every string parameter                            | The database is unchanged and the call fails or is empty |        | not run |     |
| B2  | `%`, `_` and regex characters in the transaction `search` filter            | Treated as plain text                                    |        | not run |     |
| B3  | Values at and beyond every bound, long strings                              | Rejected by the schema                                   |        | not run |     |
| B4  | Rule patterns of one character or only spaces, unknown categories           | Rejected                                                 |        | not run |     |
| B5  | Card and account numbers split by spaces or dashes, non-ASCII digits        | Masked, or I record that they are not                    |        | not run |     |
| B6  | Injection text planted in a payee, a note title, note text and a PDF        | Returned as plain data, and nothing acts on it           |        | not run |     |
| C1  | Forged Telegram updates: edited, channel, forwarded, group, no sender       | No reply, and counted as ignored                         |        | not run |     |
| C2  | Control characters, unicode, bot-name mentions, a flood of messages         | Fixed replies, rate limit holds                          |        | not run |     |
| C3  | Diary files: very long lines, odd quoting, empty, over the cap              | An error or a bounded result, never a hang               |        | not run |     |
| C4  | Symlinked files and folders, `..` names, odd characters in file names       | Nothing outside the notes folder is read                 |        | not run |     |
| C5  | A malformed PDF, a very large file, then the next scan                      | The scan survives, or I record what breaks               |        | not run |     |
| C6  | Pathological Markdown: one huge line, thousands of nested headings          | Chunking stays fast                                      |        | not run |     |
| C7  | Known fake secrets, then force an error in each service and search the logs | The fake secrets never appear                            |        | not run |     |
| C8  | Malformed responses from Akahu, Anthropic and Open-Meteo                    | The job fails cleanly and nothing is stored              |        | not run |     |

## Write-up template for a finding

When a test fails, I add a section like this under the table:

- **ID and what I tried:** the exact input.
- **What happened:** the reply, the log line, or the effect on the database.
- **Why it matters:** who could do this and what they would get.
- **Fix:** the change, with the PR, and the test that now guards it.
- **Retest:** the result after the fix.
