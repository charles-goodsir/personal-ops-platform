#!/bin/sh
# Nightly Postgres backup: one dump at startup, then every night at 03:00 (TZ).
# Dumps are owner-only (umask 077) and kept for RETAIN_DAYS. A failed dump
# exits, so Compose restarts the container and `docker compose ps` shows it.
set -eu
umask 077

# Records how the run went in job_runs, for /status and the watchdog. It must
# never break the backup: on first deploy the table may not exist yet.
heartbeat() {
  if [ "$1" = ok ]; then
    sql="INSERT INTO job_runs (job, last_success) VALUES ('backup', now())
         ON CONFLICT (job) DO UPDATE SET last_success = now(), consecutive_failures = 0"
  else
    sql="INSERT INTO job_runs (job, last_failure, consecutive_failures) VALUES ('backup', now(), 1)
         ON CONFLICT (job) DO UPDATE SET last_failure = now(), consecutive_failures = job_runs.consecutive_failures + 1"
  fi
  psql -h db -U "$PGUSER" -d "$PGDATABASE" -q -c "$sql" >/dev/null ||
    echo "could not record the backup heartbeat" >&2
}

backup() {
  file="/backups/ops-$(date +%Y-%m-%dT%H%M).dump"
  # Write to .tmp and rename, so a partial dump never looks like a good one.
  if pg_dump -Fc -h db -U "$PGUSER" -d "$PGDATABASE" -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup ok: $file ($(du -h "$file" | cut -f1))"
    heartbeat ok
  else
    rm -f "$file.tmp"
    echo "backup FAILED, see the error above" >&2
    heartbeat fail
    exit 1
  fi
  find /backups -name 'ops-*.dump' -mtime +"${RETAIN_DAYS:-14}" -print -delete
}

while true; do
  backup
  sleep $(( $(date -d 'tomorrow 03:00' +%s) - $(date +%s) ))
done
