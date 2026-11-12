# 15. One ISO 27001 clause or control a day, as its own message

Status: accepted

## Context

I am learning ISO 27001 properly, for GRC roles, and reading the standard once does not make it stick. I already get a morning briefing and a diary message, so a short daily prompt was the cheapest way to see every clause and control repeatedly, tied to things I have actually built.

## Decision

- An `iso` service sends one Telegram message at `ISO_TIME` (default 09:30 NZ, after the diary message). Each message has the clause or control number and title, what it asks, where it shows up in my own stack, and one interview-style question.
- There are 118 entries in a fixed order: clauses 4 to 10 (25 entries), then the 93 Annex A controls of the 2022 edition. The entry for a date is the number of days since `ISO_START` modulo 118, so the list repeats about every four months. A missed day is skipped, not made up, and nothing is stored.
- `ISO_START` is required. The service and Compose both refuse to start without it, so the first day is a decision, not a default.
- The content is a TypeScript array in `packages/briefing/src/iso-content.ts`, in my own words. I did not copy the standard's text, which is copyrighted. A test checks that the ids are unique, every field is filled and each message is under 1,500 characters.
- The "in my stack" lines say where I have no equivalent as well as where I do (no policy document, no Statement of Applicability, no impartial review, no restore test), because an honest gap is better interview material than a stretched claim.
- No model, no network call except Telegram, no input. It is its own container with its own heartbeat (`iso`, 26 hour limit), so a bug in it cannot touch the briefing, the diary or the summary. A failed send throws, so the heartbeat goes stale and the watchdog alerts me, as for the diary.

## Alternatives I did not take

- Writing each day's entry with a model. It adds a bill and a way for a confident wrong claim to reach me every morning, and the point is to learn the real thing.
- A section in the daily briefing. It is less to build, but a failing section would sit inside a message I rely on, and the diary decision went the other way for the same reason.
- Quoting the standard. It is paid and copyrighted, and a paraphrase I wrote myself is better for learning.
- A quiz command in the bot. It would help recall, but it adds input handling to a bot that takes none beyond fixed commands. It is a candidate for later.
- Spaced repetition or a flashcard app. Better for memory, but it needs another tool and another habit, and a message I already read is more likely to be used.

## Consequences

- I wrote the entries from memory, not with the standard open. Some wording may be wrong, so I check it against the standard before I rely on it in an interview. Until then the messages are study prompts, not references.
- The entries describe my own gaps in a public repo. Most were already in the risk assessment, and the repo is public by choice (R18), so I accepted it.
- Adding, removing or reordering entries moves which entry falls on a given date.
- The list follows the 2022 edition. If the standard changes, the file needs a new pass.
- The picker uses the NZ date, so the message and `ISO_START` agree with the rest of the system.
