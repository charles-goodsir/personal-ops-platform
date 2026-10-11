# 4. Data model: versioned vectors, and transactions that follow the source

Status: accepted

## Context

Notes change, embedding models change, and Akahu occasionally returns a transaction with a new id after heavy editing. Personal apps get no webhooks. The tables have to stay right through all of that, and they must not hold anything I would not want in a backup.

## Decision

Notes:

- `notes` holds the text and a content hash. `chunks` holds up to 1,500 characters each, split at headings (ignoring `#` inside code fences), with the heading path for citations.
- The vector index is HNSW with cosine distance. It needs no training data, so it works on an empty table. IVFFlat would not.
- Ingest skips a file only if its hash matches and every chunk came from the current model. Embedding happens before the transaction opens, so a slow model never holds locks.
- If a scan finds no files but the index has notes, it deletes nothing, because an unmounted volume looks the same as an empty folder.

Transactions:

- Keyed by Akahu's id and stored as `numeric(14,2)`, negative for money out.
- No account numbers. The Akahu parser never reads them, there is no column for them, and the `meta` block is not parsed at all because it carries other people's account numbers.
- Each sync re-reads the last 14 days and makes the table match: upsert what is there, delete what vanished from the window. Deletes are limited to the window and to active accounts, because a disconnected account returns nothing and that must not wipe its history.
- Akahu stamps a transaction at 23:59 NZ time, so NZ dates read as UTC midnights split days correctly with no timezone code.
- Each categorised row records whether a `rule` or the `model` set it. A rule always wins.
- `FINANCE_HISTORY_START` bounds how far back anything is kept, and a new account backfills from it.

## Alternatives I did not take

- Storing everything Akahu returns. It is more data to protect and I have no use for most of it.
- Deleting by absence without limits. It is simpler and it destroys history when an account disconnects.
- A separate table per source. More tables, no benefit at this size.

## Consequences

- Moving `FINANCE_HISTORY_START` later deletes older local copies on the next sync.
- A closed account is not returned by Akahu, so its history is missing.
- Several of these rules are tested by breaking them on purpose: remove the active-account filter, the window on deletes or the change check, and the matching test fails.
