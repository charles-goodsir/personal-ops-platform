# Security testing

Status: **batch A (the MCP HTTP layer) is done. Batches B and C have not been run.** The threats and their IDs come from the [threat model](threat-model.md). This file is where each test is recorded: what I tried, what should have happened, what did, and what I changed.

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

- **Repeated Authorization headers (A1).** Node's HTTP parser keeps the first copy of a repeated `Authorization` header and drops the rest. A request with a good token first and junk second therefore authenticates, and junk first fails. This is documented Node behaviour and does not weaken the check on its own, because nothing sits in front of the server that could read a different copy. It would matter if I ever put a proxy in front, so batch A records it as a test.

## Results

Result is one of: not run, pass, finding fixed, accepted. Each entry gets the PR that changed the code.

| ID  | Test                                                                        | Expected                                                 | Actual                                                                                                                                                                                                       | Result               | Fix                                                                                                  |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------- |
| A1  | Missing, empty, odd-case, spaced, repeated and very long Authorization      | 401 every time, no detail                                | 401 for all 15 odd forms, 431 for a 100 KB token, 401 for the token in the query string. Two observations below                                                                                              | pass                 | none needed                                                                                          |
| A2  | Many wrong tokens in a row                                                  | Rejected, and logged so I can see it                     | Rejected, but **nothing was logged**: a stranger could guess without leaving a trace                                                                                                                         | **finding fixed**    | PR for this step: a log line at most every 10 seconds, with a count and the address, never the guess |
| A3  | Host values: IP forms, ports, trailing dot, uppercase. Origin header        | Rejected unless on the allowlist                         | Every name that is not the allowlisted address got 403, with the right token. Other spellings of the address are accepted. No CORS permission is ever granted                                                | pass                 | none needed                                                                                          |
| A4  | Invalid, oversized and deeply nested JSON bodies                            | A clean 4xx, the process stays up                        | Clean 4xx or 413 for every body, including a 5 MB gzip bomb and 10,000 levels of nesting, and it kept answering. But the parser ran **before** the token check                                               | **finding fixed**    | PR for this step: the token is checked before the body is read                                       |
| A5  | Read every failure response above                                           | No stack trace, path or query                            | A bad body got an HTML error page announcing Express. With `NODE_ENV` not set to production it also showed a stack trace with file paths                                                                     | **finding fixed**    | PR for this step: errors and unknown paths are JSON, and the framework header is off                 |
| A6  | A burst of requests (local copy only)                                       | It keeps answering. Decide if a limit is needed          | 300 at once: nothing was ever served unauthenticated, and a real request worked straight after. Past about 128 at once my Mac's OS dropped connections. 50 half-open connections did not stop a real request | pass, limit accepted | no per-IP limit: see below                                                                           |
| A7  | GET, PUT, DELETE and OPTIONS on `/mcp`                                      | 405                                                      | 405 with the token and 401 without. Nine path variants without a token (`/MCP`, `//mcp`, `/mcp/x`, `/%6dcp` and others) never returned 200                                                                   | pass                 | none needed                                                                                          |
| A8  | Decision: an audit log of tool calls                                        | Written down in an ADR, either way                       |                                                                                                                                                                                                              | not run              |                                                                                                      |
| A9  | Decision: per-tool token scopes                                             | Written down in an ADR, either way                       |                                                                                                                                                                                                              | not run              |                                                                                                      |
| B1  | SQL injection payloads in every string parameter                            | The database is unchanged and the call fails or is empty |                                                                                                                                                                                                              | not run              |                                                                                                      |
| B2  | `%`, `_` and regex characters in the transaction `search` filter            | Treated as plain text                                    |                                                                                                                                                                                                              | not run              |                                                                                                      |
| B3  | Values at and beyond every bound, long strings                              | Rejected by the schema                                   |                                                                                                                                                                                                              | not run              |                                                                                                      |
| B4  | Rule patterns of one character or only spaces, unknown categories           | Rejected                                                 |                                                                                                                                                                                                              | not run              |                                                                                                      |
| B5  | Card and account numbers split by spaces or dashes, non-ASCII digits        | Masked, or I record that they are not                    |                                                                                                                                                                                                              | not run              |                                                                                                      |
| B6  | Injection text planted in a payee, a note title, note text and a PDF        | Returned as plain data, and nothing acts on it           |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C1  | Forged Telegram updates: edited, channel, forwarded, group, no sender       | No reply, and counted as ignored                         |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C2  | Control characters, unicode, bot-name mentions, a flood of messages         | Fixed replies, rate limit holds                          |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C3  | Diary files: very long lines, odd quoting, empty, over the cap              | An error or a bounded result, never a hang               |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C4  | Symlinked files and folders, `..` names, odd characters in file names       | Nothing outside the notes folder is read                 |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C5  | A malformed PDF, a very large file, then the next scan                      | The scan survives, or I record what breaks               |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C6  | Pathological Markdown: one huge line, thousands of nested headings          | Chunking stays fast                                      |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C7  | Known fake secrets, then force an error in each service and search the logs | The fake secrets never appear                            |                                                                                                                                                                                                              | not run              |                                                                                                      |
| C8  | Malformed responses from Akahu, Anthropic and Open-Meteo                    | The job fails cleanly and nothing is stored              |                                                                                                                                                                                                              | not run              |                                                                                                      |

## Batch A: findings and observations

Run on 12 October 2026 against a local copy. 70 tests in [`http.attack.test.ts`](../packages/mcp-server/src/attack/http.attack.test.ts).

### Finding 1 (A4, A5): the body was read before the token was checked, and errors were HTML

- **What I tried:** a POST to `/mcp` with no token and a body of `{not json`, and again with a 200 KB body.
- **What happened:** the server answered 400 and 413 from the JSON parser, not 401. The 400 was Express's HTML error page with an `X-Powered-By: Express` header. With `NODE_ENV` not set to production, that page includes a stack trace with file paths. The Docker image sets production, so the live server did not show a trace, but the protection depended on an environment variable.
- **Why it matters:** anyone who can reach port 3000 could make the server parse their body without a token, and could learn what framework it runs. It is low severity on a home LAN, and it is the kind of thing a scanner reports.
- **Fix:** the app is built in the right order: Host check, then token, then body parsing. The framework header is off, and errors and unknown paths return JSON. The SDK helper I had used put the body parser first and could not be reordered, so I build the Express app directly.
- **Retest:** the unauthenticated bad-JSON and 200 KB tests return 401. Putting the parser back first fails that test, and turning the header back on fails its test.

### Finding 2 (A2): failed guesses left no trace

- **What I tried:** 50 wrong tokens in a row, then a right one.
- **What happened:** all 50 were rejected, the right token still worked, and the log had nothing about them.
- **Why it matters:** the token is the only thing between the LAN and my data. A stranger could guess for as long as they liked and I would never know.
- **Fix:** a failure writes `mcp auth failed` with a count and the address, never the token or the guess. It writes at most once every 10 seconds, so guessing fast cannot fill the disk.
- **Retest:** the guesses show up in the log, 300 at once produce fewer than 5 lines, and the right token still works. Removing the log fails the first test, and logging every failure fails the second.

### Observations that are not findings

- **Repeated headers:** Node keeps the first copy of a repeated `Authorization` or `Host` header and drops the rest. A good token first and junk second authenticates. It would matter only behind a proxy that reads a different copy. I pin it with a test.
- **Trailing space:** HTTP trims it, so `Bearer <token> ` is the same token.
- **Other spellings of the allowed address:** the Host check parses with the URL parser, so `127.1` and `2130706433` become `127.0.0.1`. They name the same machine.
- **An empty JSON array** is a valid empty batch and gets 202.
- **A6 and the OS:** past about 128 simultaneous connections my Mac drops some before the server sees them. That is the operating system's listen backlog.

### Mistakes in my own tests

Of the first twelve failing tests, seven were my own wrong assumptions (the trailing space, three numeric Host spellings, the repeated Host header, the empty array, and a burst test that expected every connection to be answered), two were my raw client waiting for a keep-alive reply to idle, and three were real: A2 and two in A5. I fixed the harness, corrected the tests and recorded the behaviour above. I did not loosen any test that caught a real defect.

### Decision (A6): no per-IP rate limit

The token is random and at least 32 characters, a wrong guess costs one hash, failures are now visible and bounded in the log, and the server is on a home LAN. Adding a limit would also let a stranger lock me out. I accept the gap and the test pins the behaviour: a run of wrong tokens never blocks the right one.

## Write-up template for a finding

When a test fails, I add a section like this under the table:

- **ID and what I tried:** the exact input.
- **What happened:** the reply, the log line, or the effect on the database.
- **Why it matters:** who could do this and what they would get.
- **Fix:** the change, with the PR, and the test that now guards it.
- **Retest:** the result after the fix.
