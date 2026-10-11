#!/bin/sh
# Nightly Postgres backup: one dump at startup, then every night at 03:00 (TZ).
# Dumps are owner-only (umask 077) and kept for RETAIN_DAYS.
set -eu
umask 077

backup() {
  file="/backups/ops-$(date +%Y-%m-%dT%H%M).dump"
  # Write to .tmp and rename, so a partial dump never looks like a good one.
  if pg_dump -Fc -h db -U "$PGUSER" -d "$PGDATABASE" -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "backup FAILED" >&2
  fi
  find /backups -name 'ops-*.dump' -mtime +"${RETAIN_DAYS:-14}" -print -delete
}

while true; do
  backup
  sleep $(( $(date -d 'tomorrow 03:00' +%s) - $(date +%s) ))
done
