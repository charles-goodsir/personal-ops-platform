# 9. Yesterday's diary entries as their own morning message

Status: accepted

## Context

My notes are mostly my diary entries, which live in the `cyberDiaryEntries.ts` file of my public my-portfolio repo. The notes folder on the mini PC is not synced from my laptop, so the briefing's notes section could never mention recent work. I wanted a short summary of the previous day's work each morning.

## Decision

- A `diary` service sends one Telegram message at `DIARY_TIME` (default 09:00 NZ, after the briefing): the title and `workedOn` bullets of every entry dated yesterday (NZ date). It sends nothing on a day with no entry. `Next:` bullets are left out, because they are plans, not work done. Each entry shows at most 8 bullets.
- It reads the entries from the raw file on GitHub. The URL is fixed in code, the request has a 15 second timeout and a 2 MB cap, and no credentials are sent because the repo is public.
- The file is parsed, never run. The parser relies on Prettier's layout: an entry's own fields sit at four spaces and its bullets at six, so the same names nested deeper (a lab's title) are ignored. A test runs against a copy of the top of the real file, and I checked once that all 90 entries parse.
- A file that parses to no entries is an error, not a quiet day. The heartbeat then stays old and the watchdog alerts me, instead of every day looking like a day off.
- The service is its own container with its own heartbeat (`diary`, 26 hour limit), so a bug in it cannot touch the briefing or the weekly summary. No model is involved.

## Alternatives I did not take

- Parsing the file with the TypeScript compiler, or running it. Running remote code on the mini PC for a message is not worth it, and the compiler is not in the runtime image.
- A small JSON file published from my-portfolio. It is the stable contract and the upgrade if the parser ever proves fragile, but it needs a build step in that repo and a file that can fall behind the source.
- Syncing the notes folder from my laptop. It is the right fix for the knowledge base, but it needs the laptop to be on, and the diary is the only part I wanted here.
- Folding it into the daily briefing. One more section is simpler, but a failing section would sit inside a message I rely on, and I kept the Monday messages separate for the same reason.
- A model-written summary. My own bullets are already a summary, and a model would add a bill and a way for text to steer it.

## Consequences

- The message is only as fresh as what I have pushed to `main`. An entry that is still on my laptop does not appear.
- If I change how the file is formatted, the parser can break. The no-entries rule makes that loud, and a test against a real copy of the file catches most changes in CI.
- The text comes from my own public repo and goes to my own chat. If someone took over my GitHub account, they could put words into that message. It carries text only: nothing is run, and it is length-capped.
- GitHub sees a request from my home IP each morning for a public file.
- The first manual send was for 12 October, and the first unattended message is due the next morning.
