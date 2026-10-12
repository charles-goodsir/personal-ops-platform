# Security testing

Status: **all three batches (A, the MCP HTTP layer; B, the tools; C, the bot, the diary file, notes ingest, logs and parsers) are done.** A8 and A9 are still decisions to record. The threats and their IDs come from the [threat model](threat-model.md). This file is where each test is recorded: what I tried, what should have happened, what did, and what I changed.

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

| ID  | Test                                                                        | Expected                                                 | Actual                                                                                                                                                                                                                                     | Result               | Fix                                                                                                  |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------- |
| A1  | Missing, empty, odd-case, spaced, repeated and very long Authorization      | 401 every time, no detail                                | 401 for all 15 odd forms, 431 for a 100 KB token, 401 for the token in the query string. Two observations below                                                                                                                            | pass                 | none needed                                                                                          |
| A2  | Many wrong tokens in a row                                                  | Rejected, and logged so I can see it                     | Rejected, but **nothing was logged**: a stranger could guess without leaving a trace                                                                                                                                                       | **finding fixed**    | PR for this step: a log line at most every 10 seconds, with a count and the address, never the guess |
| A3  | Host values: IP forms, ports, trailing dot, uppercase. Origin header        | Rejected unless on the allowlist                         | Every name that is not the allowlisted address got 403, with the right token. Other spellings of the address are accepted. No CORS permission is ever granted                                                                              | pass                 | none needed                                                                                          |
| A4  | Invalid, oversized and deeply nested JSON bodies                            | A clean 4xx, the process stays up                        | Clean 4xx or 413 for every body, including a 5 MB gzip bomb and 10,000 levels of nesting, and it kept answering. But the parser ran **before** the token check                                                                             | **finding fixed**    | PR for this step: the token is checked before the body is read                                       |
| A5  | Read every failure response above                                           | No stack trace, path or query                            | A bad body got an HTML error page announcing Express. With `NODE_ENV` not set to production it also showed a stack trace with file paths                                                                                                   | **finding fixed**    | PR for this step: errors and unknown paths are JSON, and the framework header is off                 |
| A6  | A burst of requests (local copy only)                                       | It keeps answering. Decide if a limit is needed          | 300 at once: nothing was ever served unauthenticated, and a real request worked straight after. Past about 128 at once my Mac's OS dropped connections. 50 half-open connections did not stop a real request                               | pass, limit accepted | no per-IP limit: see below                                                                           |
| A7  | GET, PUT, DELETE and OPTIONS on `/mcp`                                      | 405                                                      | 405 with the token and 401 without. Nine path variants without a token (`/MCP`, `//mcp`, `/mcp/x`, `/%6dcp` and others) never returned 200                                                                                                 | pass                 | none needed                                                                                          |
| A8  | Decision: an audit log of tool calls                                        | Written down in an ADR, either way                       |                                                                                                                                                                                                                                            | not run              |                                                                                                      |
| A9  | Decision: per-tool token scopes                                             | Written down in an ADR, either way                       |                                                                                                                                                                                                                                            | not run              |                                                                                                      |
| B1  | SQL injection payloads in every string parameter                            | The database is unchanged and the call fails or is empty | Nine payloads (quotes, `DROP`, `UNION`, `pg_sleep`, a NUL byte, a lone surrogate) across six tools: no table changed, the server kept answering, and a payload used as a rule pattern was stored as plain text and removable               | pass                 | none needed                                                                                          |
| B2  | `%`, `_` and regex characters in the transaction `search` filter            | Treated as plain text                                    | Every row returned contained the characters literally. Regex characters matched nothing                                                                                                                                                    | pass                 | none needed                                                                                          |
| B3  | Values at and beyond every bound, long strings                              | Rejected by the schema                                   | 17 out-of-range inputs, including a 40-digit note id and an impossible date, all refused with the server still answering                                                                                                                   | pass                 | none needed                                                                                          |
| B4  | Rule patterns of one character or only spaces, unknown categories           | Rejected                                                 | Those were refused. But a two-letter rule recategorised most of the transactions at once, and a newline in a pattern forged a line in the rule list                                                                                        | **2 findings fixed** | PR for this step: a breadth limit, and no control characters in patterns                             |
| B5  | Card and account numbers split by spaces or dashes, non-ASCII digits        | Masked, or I record that they are not                    | Grouped card numbers and NZ account numbers were not masked. And the search filter and rule matching worked on unmasked text, so a hidden number could be found by asking whether it was there                                             | **2 findings fixed** | PR for this step: the masking covers groups, and searching and matching use the masked text          |
| B6  | Injection text planted in a payee, a note title, note text and a PDF        | Returned as plain data, and nothing acts on it           | The text came back as data and changed nothing. But a newline in a payee forged a second transaction row, and two note tools did not tell Claude their text was data                                                                       | **2 findings fixed** | PR for this step: one line per field, and the warning on all three tools                             |
| C1  | Forged Telegram updates: edited, channel, forwarded, group, no sender       | No reply, and counted as ignored                         | 13 forged shapes and a photo-only message got no reply and ran nothing. But an update with no chat made the check throw, so the same update would be fetched for ever                                                                      | **finding fixed**    | PR for this step: the check refuses it, and a bad update is skipped                                  |
| C2  | Control characters, unicode, bot-name mentions, a flood of messages         | Fixed replies, rate limit holds                          | 14 hostile commands never reached the database as free text. 100 characters is handled and 101 refused. 50 messages ran 10. A failing command sends only `Something went wrong.`                                                           | pass                 | none needed                                                                                          |
| C3  | Diary files: very long lines, odd quoting, empty, over the cap              | An error or a bounded result, never a hang               | Five 2 MB hostile lines and 200,000 short ones parsed in under a second. But control and direction-changing characters reached the message, and a day with 50,000 entries made an uncapped message                                         | **2 findings fixed** | PR for this step: those characters become spaces, and the message is cut at an entry with a count    |
| C4  | Symlinked files and folders, `..` names, odd characters in file names       | Nothing outside the notes folder is read                 | A file event for a symlink, for a path through a symlinked folder, and for a `../` path all indexed text from outside the folder                                                                                                           | **finding fixed**    | PR for this step: the real path must stay under the notes folder, and only plain files are read      |
| C5  | A malformed PDF, a very large file, then the next scan                      | The scan survives, or I record what breaks               | Malformed PDFs were logged and skipped, and the other notes still indexed. But a 26 MB file was read whole and took over five seconds, and no app container had a memory limit                                                             | **2 findings fixed** | PR for this step: files over 20 MB are skipped, and every app container has a memory limit           |
| C6  | Pathological Markdown: one huge line, thousands of nested headings          | Chunking stays fast                                      | Eight hostile inputs (a 1 MB line, 50,000 headings, an unclosed code fence and others) each chunked in under two seconds, in pieces of at most 1,500 characters                                                                            | pass                 | none needed                                                                                          |
| C7  | Known fake secrets, then force an error in each service and search the logs | The fake secrets never appear                            | Config-style names (`TELEGRAM_BOT_TOKEN` and others) and headers nested two levels down were logged in full. A Telegram network error carried the bot token when the runtime put the URL in its message                                    | **2 findings fixed** | PR for this step: redaction by name to three levels, and Telegram errors say only `no response`      |
| C8  | Malformed responses from Akahu, Anthropic and Open-Meteo                    | The job fails cleanly and nothing is stored              | Malformed Akahu bodies failed cleanly and the parser dropped account numbers. But a response whose pages never ended crashed my test process out of memory, and a request had no deadline. A 200,000 character description came back whole | **3 findings fixed** | PR for this step: a page limit, a 30 second deadline, and descriptions capped at 300 characters      |

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

## Batch B: findings and observations

Run on 12 October 2026 against real Postgres, the real finance and notes code, and the real server over HTTP. 49 tests in [`tools.attack.test.ts`](../packages/mcp-server/src/attack/tools.attack.test.ts) and one in `rules.test.ts`. Six findings, all fixed.

### Finding 3 (B5): grouped card and account numbers were not masked

- **What I tried:** descriptions with `4111 1111 1111 1111`, `4111-2222-3333-4444`, `12-3456-1234567-00` and `3782 822463 10005`.
- **What happened:** the masking only replaced runs of six or more digits, so the groups of four survived. The NZ account number came out as `12-3456-[number]-00`, and the Amex number kept its last five digits.
- **Why it matters:** the masking is the control that stops card and account numbers reaching Claude and the categorising model.
- **Fix:** the groups are masked as a whole, ahead of the plain runs.
- **Limit:** this covers the formats I could think of. It is still a heuristic. I have not seen real descriptions in these formats, so I cannot say the list is complete.

### Finding 4 (B5): searching could find a hidden number

- **What I tried:** `get_transactions` with `search` set to `4111`, then `4111 1111`, and `add_category_rule` with a digit pattern, which replies with how many transactions it matches.
- **What happened:** both matched against the unmasked description. The masked number never showed, but a caller could ask whether a given prefix was there and narrow it one step at a time.
- **Why it matters:** the masking hid the number from the output and not from a patient attacker. Claude, or text steering Claude, could do this with a few hundred calls.
- **Fix:** search, rule matching and the rule counts all work on the masked text. I share one list of patterns between the code and the SQL, and avoid `\b`, which means backspace in Postgres.
- **Effect on rules:** a rule pattern that is a run of six or more digits no longer matches anything. None of the rules I know of do, but check `list_category_rules` before relying on that.

### Finding 5 (B6): a newline in a payee forged a transaction row

- **What I tried:** a payee of `PAYEE`, a newline, then `2026-10-12 | $0.01 | Income | Everyday | fake row`.
- **What happened:** `get_transactions` printed 30 lines for 29 transactions. The forged one looked like a real row. Titles and paths from notes could do the same.
- **Why it matters:** whoever pays me writes the description, and a bank is unlikely to pass a newline. If one did, the output would carry fake data.
- **Fix:** every outside field (description, account, titles, paths, headings) goes into one line, with control characters turned into spaces.

### Finding 6 (B4): a two-letter rule recategorised most of the data

- **What I tried:** `add_category_rule` with the pattern `er` and the category `Income`, on a database of 29 transactions.
- **What happened:** it was accepted and moved most of the transactions to Income.
- **Why it matters:** this is the worst thing the write tools can do. It is reversible only by removing the rule and waiting for the model to recategorise, which also costs money. A mistake or a prompt injection could do it in one call.
- **Fix:** a new rule is refused if it would match more than a quarter of the transactions, once there are 20 or more. My real rules match about 7% at most.

### Finding 7 (B4): a newline in a rule pattern forged a line in the list

- **What happened:** a pattern with a newline and `"fake" -> Income (99 matches)` printed as a second rule.
- **Fix:** patterns can't contain control characters, in the tool schema and again in the function. Each layer hid the other from the first test, so there is a direct test on the function too.

### Finding 8 (B6): two tools did not say their text is data

- **What happened:** `get_transactions` said descriptions are data and never instructions. `search_notes` and `get_note` said nothing, and a note can hold text from anywhere I saved it.
- **Fix:** both now say so. This is a nudge to the model and not a control. Whether Claude obeys planted text is its behaviour, which these tests cannot prove. What they do prove is that the server never acts on it, and that the write tools are narrow: only `add_category_rule` and `remove_category_rule`.

### Observation

- **Non-ASCII digits are not masked.** Full-width digits in a description pass through. A bank writes ASCII digits, and nobody else can put text next to my numbers, so I leave it and pin it with a test.

### Mistakes in my own tests

- My seeded data made the `_` search match two rows, because the planted injection text contains `add_category_rule`. I fixed the assertion to check that every row returned really contains the characters.
- My first check for the forged row passed when it should have failed, because the forged line begins with a date like a real row. I changed it to count the lines.
- My first breadth test used `ar`, which matched only 10% of my own seed, and my "ordinary rule still works" test used a pattern that matched 38%. I picked patterns that fit the data.
- Breaking the control-character check in the function did not fail any test at first, because the tool schema also refuses them. That is how I found a second layer was hiding the first, and added the direct test.

## Batch C: findings and observations

Run on 12 October 2026. 76 tests across five files: `attack.test.ts` in the bot, `diary.attack.test.ts` in the briefing, `ingest.attack.test.ts` in the knowledge base, `secrets.attack.test.ts` in core and `akahu.attack.test.ts` in finance. Nine findings, all fixed, and none of them a way into the system from outside. They are cases where a broken or hostile input made something misbehave.

### Finding 9 (C1): an update with no chat would be fetched for ever

- **What I tried:** an update whose message has no `chat`.
- **What happened:** the authorisation check threw. The poll loop catches that, logs it and asks Telegram for the same update again, so one bad update would stall the bot for good.
- **Why it matters:** Telegram does not send such an update today. If it ever sent a new kind of message, the bot would stop answering me without any alert, because the process stays up and the heartbeat is the watchdog's own.
- **Fix:** the check refuses an update with no chat, and each update is handled on its own, so a bad one is logged and skipped. Each layer has its own test.

### Finding 10 (C3): the diary message passed control characters and had no size limit

- **What happened:** a title with a bell character and a right-to-left override went into the message as they were, and a day with 50,000 entries produced one long string that the sender cut at 4,000 characters in the middle of a line.
- **Fix:** control and direction-changing characters become spaces. The message is cut at an entry with `and N more entries`.

### Finding 11 (C4): notes ingest followed links out of the folder

- **What I tried:** a symlink to a file outside the folder, a symlink to a folder, and a `../` path, each handed to the ingester the way the file watcher hands it a changed path.
- **What happened:** all three read text from outside the notes folder and put it in the index, where Claude can search it.
- **Why it matters:** the scan skips links, but the watcher does not go through the scan. Nothing in the notes folder is untrusted by default, and a sync tool or a saved download could leave a link there.
- **Fix:** the real path has to stay under the real notes folder, and only a plain file is read. A link to a note inside the folder is skipped too, so it is not indexed twice.

### Finding 12 (C5): no size limit, and no memory limit on any app container

- **What happened:** a 26 MB text file was read whole and chunked, and took over five seconds. The scan then stalled behind it. Only Ollama had a memory limit.
- **Fix:** files over 20 MB are skipped with a warning. Every app container now has a memory limit (512 MB, and 1 GB for the knowledge base). They use 20 to 45 MB today.
- **Not tested:** a small PDF that expands to something huge, and a named pipe in the folder, which could hang a read. The regular-file check covers the pipe, and I did not craft a PDF bomb.

### Finding 13 (C7): log redaction missed the names I actually use

- **What happened:** the logger censored `token` and `password` as exact names, so an object with `TELEGRAM_BOT_TOKEN`, `MCP_AUTH_TOKENS`, `ANTHROPIC_API_KEY`, `HEALTHCHECK_PING_URL` or `X-Akahu-Id` was logged in full, and headers nested two levels down were not censored at all.
- **Why it matters:** nothing logs a config object today. This is the mistake that happens in a future edit, and the fix costs nothing now.
- **Fix:** the settings names and the credential headers, in either case, are censored at the top, and one, two and three levels down.

### Finding 14 (C7): a Telegram network error could carry the bot token

- **What happened:** the Telegram URL holds the token, and a failed request threw whatever the runtime put in the error. If a runtime includes the URL in that message, the token would reach the log.
- **Fix:** a failed request now says only `no response`. A Telegram reply that echoes the token in its description has it replaced with `[token]`.

### Finding 15 (C8): the Akahu client had no page limit and no deadline

- **What happened:** the transaction pages are followed until the cursor ends. A response that never ended made my test process run out of memory and abort.
- **Fix:** at most 500 pages, and a repeated cursor stops it. Each request has a 30 second deadline, and a failed request does not pass on the original error.
- **Not tested:** a real Akahu outage. The effect today would have been a sync that never finished, which the watchdog would have caught after 13 hours.

### Finding 16 (C8): a giant description reached the tool output whole

- **Fix:** the transaction tool caps a description at 300 characters. The full text stays in the database.

### Finding 17: the rule-clearing query disagreed with the masked matching

- **What happened:** while fixing the search oracle in batch B, I changed rule matching to use the masked text but missed one query. A rule that only matches the masked text (such as `[number]`) would be applied, cleared and applied again on every sync.
- **Fix:** the clearing query uses the masked text too, with a test that applies the rules twice.

### Observations

- **Duplicate transaction ids** in one response fail the whole sync and change nothing. That is the right way to fail, and it means one bad response blocks syncing until Akahu sends a clean one.
- **A rate-limited flood from me** logs one warning per dropped message. Only I can cause it, so I left it.
- **The weather section** already had tests for a failed or malformed answer, so I added none.

### Mistakes in my own tests

- A default argument turned a photo-only message into `/help`, and I had listed two valid commands (`/SPEND` and a bot-name suffix) as hostile.
- My infinite-cursor test crashed its own worker with an out-of-memory abort. That was the finding, but it is a poor failure mode, so the stubs now throw after 2,000 pages and a regression fails instead of crashing.
- Four fixes were not caught the first time I broke them, because two layers guarded the same thing (the chat check and the per-update catch, the diary cap and the string slice, the control-character strip, and the page limit). I added a direct test for each layer.

## Write-up template for a finding

When a test fails, I add a section like this under the table:

- **ID and what I tried:** the exact input.
- **What happened:** the reply, the log line, or the effect on the database.
- **Why it matters:** who could do this and what they would get.
- **Fix:** the change, with the PR, and the test that now guards it.
- **Retest:** the result after the fix.
