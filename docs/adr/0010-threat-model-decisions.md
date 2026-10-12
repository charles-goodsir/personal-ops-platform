# 10. Decisions from the threat model: an audit line, one token, no rate limit

Status: accepted

## Context

The [threat model](../threat-model.md) left three questions as decisions and not tests: whether the MCP server should keep an audit log (A8), whether tokens should have scopes (A9), and whether to rate limit guessing (A6). The [attack tests](../security-testing.md) found the server was silent about failed guesses and about what was called, which is what made A8 worth deciding.

## Decision

- **A8, an audit line per request.** Every request that gets past the token writes one log line: the JSON-RPC method, the tool name, the names of the arguments, the HTTP status, how long it took and where it came from. Argument values are never logged, because they can hold my data. Names the caller chose are cut to 50 characters, a request logs at most 10 calls and 20 argument names each, and a request refused at the door is covered by the failed-guess line from batch A, which is limited to one per 10 seconds. The log is the existing container log. There is no new table.
- **A9, one token with every tool.** I am the only user, the two write tools can only change categories, and a rule that would match more than a quarter of the transactions is refused. I accept one token and will revisit this if a second user or a free-text bot is added.
- **A6, no per-address rate limit on `/mcp`.** The token is random and at least 32 characters, a wrong guess costs one hash, failures are now logged, and a limit would let a stranger lock me out of my own server.

## Alternatives I did not take

- **An append-only table for the audit log.** It would survive a container restart and could be queried. It needs a migration and more code, and it becomes one more store of my data to protect. I would take it if I needed to answer a question the log cannot.
- **Logging argument values.** It would show exactly what was asked, and it would put transaction search terms and note queries into a log file. The names are enough to see which tool was used and how.
- **A read-only token and a write token.** It is the better answer to least privilege, so Claude's everyday connection could not edit rules. It needs a second token and a second connection, and it protects against a small set of actions, so it waits.
- **A per-address limit with a lockout.** It would stop guessing, which the token's length already does, and it adds a way to lock me out.

## Consequences

- I can now see what was called and when, and a stranger guessing is visible. I cannot see which values were used, and the log rotates with the container, so it is a short memory and not a record.
- A call that the schema refuses is still logged, because the line is written at the HTTP layer. Its outcome in the log is the HTTP status, which is 200 even for a tool error. The log says what was asked, not whether it worked.
- The one token means that anyone holding it can call the two rule tools. The mitigations are the breadth limit, the reversible and category-only scope of the changes, and Claude Code asking before it runs a tool.
- The address in the log is the one the server sees. Behind a proxy it would be the proxy's, which does not apply today.
