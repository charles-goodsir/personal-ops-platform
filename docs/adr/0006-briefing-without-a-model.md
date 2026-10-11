# 6. A daily briefing built from plain code, and a separate weekly summary

Status: accepted

## Context

I want one short message each morning with yesterday's spending, notes that changed, and the weather. A failure in one source should not stop the others, and the briefing should not add a new way for untrusted text to reach a model.

## Decision

- A section is a name and a function returning text, or nothing when it has nothing to say. The runner builds all sections at once, each with a 15 second timeout, and joins them under a dated header.
- A section that throws or hangs shows as `<name>: unavailable` and the rest still send. The error goes to the log, never into the message. If every section fails the message says so.
- The sections are plain code: finance reads the existing spending API, notes lists titles from a new `notesChangedSince` function, and weather asks Open-Meteo for a one-day forecast. Only the coordinates leave the box.
- It runs at `BRIEFING_TIME` (NZ, default 07:00). A failed send is retried an hour later, not at the next day's time, so one bad night does not skip a day.
- The weekly summary stays a separate message on Monday at 08:00, written by Sonnet from aggregates. On Mondays there are two messages.

## Alternatives I did not take

- A model-written briefing. Payee names and note titles are untrusted text, an API outage would break the morning message, and plain code is enough for three short sections.
- Folding the weekly summary into the briefing. It is a reasonable later change, but it would put a model call inside something that works without one.
- Exiting on a failed send and letting Compose restart the service. A restarted service waits for the next scheduled time, so a failure would drop the whole day.

## Consequences

- The briefing works with no API key and costs nothing to run.
- Nothing alerts me when a send fails or a section keeps failing. It shows in the logs only.
- The schedule and retry loop have no automated test. `--once` proves the sections, sender and config, and only an unattended morning proves the timer.
- The finance section can look light if Akahu's daily refresh is late, and the notes section reports file modification time, so it cannot tell a new note from an edited one.
