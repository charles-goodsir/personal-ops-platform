# 5. What leaves the box: masking, aggregates and a small write surface

Status: accepted

## Context

Categorising transactions and writing a weekly summary are good jobs for a language model, and they need bank data. The rule is that financial data stays on the mini PC and only the minimum goes to the Claude API. Claude also reads transactions through the MCP tools, and a payment reference is free text written by whoever pays me, so it is untrusted.

## Decision

- Categorisation sends only a masked description, the amount, the type, and Akahu's merchant and category names. Each item is numbered within its batch of 50. No account numbers or account names are sent. A cheap model (`claude-haiku-5-5`, low effort) does it.
- Masking replaces runs of 6 or more digits with `[number]`, and anything after a run of asterisks with `[card]`, because a bank's own mask still ends in real card digits. The same masking applies to what the read tools return.
- The category list is a real `enum` in a hand-written JSON schema. SDK 0.128's zod helper turned the enum into a description, so the API was only hinted at the list, and the first live run failed on a category that was not in it. A test checks the MCP tools carry the enum too.
- The weekly summary sends aggregates: totals, category sums, and a few payee names with digits masked. The model is `CLAUDE_SUMMARY_MODEL`.
- My own rules are checked first and always beat the model. The only tools that change data are the rule tools, and they can only change categories: no deletes, nothing sent anywhere, every change logged and reversible.
- The API key is billed through the Console on prepaid credit with a spend limit, and it expires on 1 January 2027.

## Alternatives I did not take

- A local model for categorisation. It would compete with the embedder for 8 GB, and I did not try it.
- Rules only, with nothing sent. Safest, but I would be writing rules for ever.
- Sending raw descriptions. The digits are not needed to categorise a transaction.

## Consequences

- Names in person-to-person payments are still sent as written, and so are payee names in the summary. That is recorded in the README, not hidden.
- Through the tools, a prompt injection in a payment reference can change a category and nothing else. No tool deletes data or sends anything out. It could still mislead Claude's answer in chat, which no control here prevents.
- If the key expires, transactions keep syncing and rules keep working, but new ones stay uncategorised and the summary falls back to plain numbers.
- Tests break the controls on purpose: with the payee masking removed, two summary tests fail.
