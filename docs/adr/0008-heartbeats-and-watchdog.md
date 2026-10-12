# 8. Heartbeats and a watchdog, so a silent failure becomes a message

Status: accepted

## Context

Every job (finance sync, notes scan, backup, briefing, summary) retried quietly and only logged. If one stopped working I would find out when I noticed something missing. I wanted a Telegram message when a job goes stale, and a way to ask for the state on demand.

## Decision

- A `job_runs` table holds one row per job: the last success time and the last attempt time. Each job records a heartbeat when it finishes. `backup.sh` records its own through `psql`.
- No error text is stored. A failure leaves the old success time in place, and the job simply gets older.
- One set of rules decides if a job is healthy: it is stale when its last success is older than `MAX_QUIET_MS` for that job. The limits are 1 hour for the notes scan, 26 hours for the finance sync, the backup and the briefing, and 8 days for the summary. Each is the schedule plus slack.
- `/status` and the watchdog both use those rules, so they cannot disagree.
- The watchdog runs inside the `bot` service every 5 minutes. It sends one alert when a job goes stale, then one "working again" when it recovers. Messages carry the job name and its age, nothing else.
- The alert is sent before it is marked as sent. If Telegram fails, the next check tries again.
- A job that has never run does not alert.

## Alternatives I did not take

- Alerting on every failed attempt. Jobs retry on their own, so one bad call at 3am would wake me for nothing. Staleness only fires when retries have not worked for long enough to matter.
- Storing the error message. It helps debugging, but errors can carry URLs, tokens or payee text into a table and then into Telegram. The logs already have the detail.
- A separate monitoring service. It would be one more container to keep alive, to watch the thing that watches the rest.

## Consequences

- If the `bot` service is down, nothing alerts. The watchdog lives there.
- If Telegram is down, an alert cannot be delivered. It is retried every 5 minutes until it is.
- The briefing job counts as successful even when one section shows as unavailable, because the message still went out.
- The notes scan heartbeat covers the startup scan and the 15-minute rescans, not file events, so it shows the scheduler is alive and not that every edit was indexed.
- A job that has never run does not alert, so a service that fails on its first start stays quiet until it succeeds once. The briefing and summary have no row until their first run.
- The real fix for the first two is a check from outside the mini PC, such as a dead-man's switch that alerts when a ping stops arriving. It is in `IDEAS.md`.
- I proved it live by backdating the notes scan heartbeat by 20 hours. The alert arrived about 90 seconds later, and "working again" arrived after the next real rescan.

## Update: an outside check for the watchdog

The first two consequences above were the real gap: the watchdog lives in the `bot` service and sends through Telegram, so if either is down, nothing alerts me. A monitor on the same box shares the failures it is meant to catch.

### Decision

- The `bot` service pings a Healthchecks.io check after each watchdog check that worked. The check expects a ping every 5 minutes, with 10 minutes of grace, and emails me when the pings stop. Email is the channel because Telegram may be the thing that is down.
- No ping is sent when the watchdog's own check fails, for example because the database is unreachable. A watchdog that cannot read the heartbeats is not working, and silence is what I want Healthchecks to see.
- A failed ping is only logged. A dead Healthchecks must never stop the real alerts.
- The ping is a plain GET with a 10 second timeout and no body. Its URL carries a random id that is the only secret, so it lives in `.env` (`HEALTHCHECK_PING_URL`, mode 600), must be `https`, and never appears in an error or a log line. The setting is optional: unset, nothing pings.

### Alternatives I did not take

- Uptime Kuma. It is self-hosted, so it has to run off the mini PC, and I have no second machine for it.
- My own Cloudflare Worker with a cron. It works, but I would be writing the alert logic myself (one alert per incident, recovery, grace), which is the part a hosted product has already had years of use on. I would take this for the learning, not for the safety, and keep Healthchecks running beside it.

### Consequences

- Healthchecks sees that my home IP pings every 5 minutes, so it can tell when the box is up. It receives no data, job names or message text.
- Anyone who learns the URL id can send pings and hide an outage. That is why it is treated like a token.
- A ping proves the bot service, its database connection and the watchdog loop are alive. It does not prove Telegram works, and it does not say which job is stale. The watchdog still does that.
- If Healthchecks is down at the same time as the box, nothing alerts me. I accept that.
- I proved it by stopping the `bot` service on the mini PC and waiting. The check went down and the email arrived.
