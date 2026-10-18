#!/usr/bin/env bash
# Checks for a new signed image on GHCR and deploys it. A systemd timer runs it
# nightly (see deploy/), and I can run it by hand: scripts/update.sh [--dry-run].
#
# The box only makes outbound calls. A new image is deployed only when its
# signature was made by this repo's release workflow on main, and it is checked
# by digest, so the bytes that were verified are the bytes that are pulled. If
# the new image does not stay up, the previous one goes back. The database is
# not rolled back: a migration that has run stays, so a migration has to work
# with the release before it.
#
# UPDATE_IMAGE and UPDATE_TAG exist so the refusals can be tried against other
# images. The signature identity is not an option.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${UPDATE_IMAGE:-ghcr.io/charles-goodsir/personal-ops}"
TAG="${UPDATE_TAG:-main}"
IDENTITY="https://github.com/charles-goodsir/personal-ops-platform/.github/workflows/release.yml@refs/heads/main"
ISSUER="https://token.actions.githubusercontent.com"
# How long the new containers must stay up, and how long to wait for that.
STABLE_SECONDS="${UPDATE_STABLE_SECONDS:-60}"
HEALTH_TIMEOUT="${UPDATE_HEALTH_TIMEOUT:-180}"
STATE=.deploy
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { echo "$(date -Is) $*"; }

env_value() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true; }

# One Telegram message with fixed words and a short digest, never a log. The
# token goes in through stdin so it is not in the process list.
alert() {
  [ "$DRY_RUN" = 1 ] && return 0
  local token chat
  token=$(env_value TELEGRAM_BOT_TOKEN)
  chat=$(env_value TELEGRAM_CHAT_ID)
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
    curl -sS -m 20 -K - --data-urlencode "chat_id=$chat" --data-urlencode "text=$1" -o /dev/null ||
    log "could not send the alert"
}

# Records the run in job_runs, for /status and the watchdog. It never breaks
# the update: the database may be what is down.
heartbeat() {
  [ "$DRY_RUN" = 1 ] && return 0
  local sql
  if [ "$1" = ok ]; then
    sql="INSERT INTO job_runs (job, last_success) VALUES ('image-update', now())
         ON CONFLICT (job) DO UPDATE SET last_success = now(), consecutive_failures = 0"
  else
    sql="INSERT INTO job_runs (job, last_failure, consecutive_failures) VALUES ('image-update', now(), 1)
         ON CONFLICT (job) DO UPDATE SET last_failure = now(), consecutive_failures = job_runs.consecutive_failures + 1"
  fi
  docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -c "$0"' "$sql" >/dev/null 2>&1 ||
    log "could not record the heartbeat"
}

fail() {
  log "FAILED: $1"
  alert "$2"
  heartbeat fail
  exit 1
}

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || { log "another update is running"; exit 0; }

command -v cosign >/dev/null || fail "cosign is not installed" "Image update failed: cosign is not installed."

digest=$(docker buildx imagetools inspect "$IMAGE:$TAG" --format '{{.Manifest.Digest}}' 2>/dev/null) ||
  digest=$(docker buildx imagetools inspect "$IMAGE:$TAG" 2>/dev/null | awk '/^Digest:/ {print $2; exit}') || true
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "could not read the digest of $IMAGE:$TAG" "Image update failed: could not read the new image's digest."
short=${digest:7:12}

current=$(cat "$STATE/current" 2>/dev/null || true)
rejected=$(cat "$STATE/rejected" 2>/dev/null || true)
if [ "$digest" = "$current" ]; then
  log "up to date ($short)"
  heartbeat ok
  exit 0
fi
if [ "$digest" = "$rejected" ]; then
  fail "$short failed to start before and is skipped until there is a newer image" "Image update: $short failed to start before, so it is skipped. Waiting for a newer image."
fi

# By digest, not by tag: nothing can move between this check and the pull.
if ! cosign verify "$IMAGE@$digest" --certificate-identity "$IDENTITY" --certificate-oidc-issuer "$ISSUER" >/dev/null 2>"$STATE/verify.err"; then
  log "REFUSED: the signature check failed for $short"
  tail -n 3 "$STATE/verify.err" | cut -c1-300
  alert "Image update refused: the signature check failed for $short. Nothing was changed."
  heartbeat fail
  exit 1
fi
log "signature ok for $short"

if [ "$DRY_RUN" = 1 ]; then
  log "dry run: would update to $short (running: ${current:-nothing recorded})"
  exit 0
fi

docker pull -q "$IMAGE@$digest" >/dev/null
revision=$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE@$digest" 2>/dev/null | cut -c1-7 || true)

# What is running now, so a restart loop can be told from a restart that was already there.
declare -A before_id before_restarts
mapfile -t services < <(docker compose config --services | grep -vxE 'migrate|ollama-pull')
for s in "${services[@]}"; do
  cid=$(docker compose ps -q "$s" | head -n 1)
  before_id[$s]=$cid
  before_restarts[$s]=$([ -n "$cid" ] && docker inspect -f '{{.RestartCount}}' "$cid" || echo 0)
done

stays_up() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) since=-1 ok s cid state
  while [ "$SECONDS" -lt "$deadline" ]; do
    ok=1
    for s in "${services[@]}"; do
      cid=$(docker compose ps -q "$s" | head -n 1)
      [ -n "$cid" ] || { ok=0; break; }
      state=$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$cid")
      # A container made by this update must not have restarted at all. One that
      # was left alone must not have restarted since before.
      if [ "$cid" = "${before_id[$s]}" ]; then want="true ${before_restarts[$s]}"; else want="true 0"; fi
      [ "$state" = "$want" ] || { ok=0; break; }
    done
    if [ "$ok" = 1 ]; then
      [ "$since" -lt 0 ] && since=$SECONDS
      [ $((SECONDS - since)) -ge "$STABLE_SECONDS" ] && return 0
    else
      since=-1
    fi
    sleep 5
  done
  return 1
}

rollback() {
  log "rolling back to the previous image"
  echo "$digest" > "$STATE/rejected"
  if docker image inspect personal-ops:previous >/dev/null 2>&1; then
    docker tag personal-ops:previous personal-ops:local
    docker compose up -d || log "the rollback did not come up cleanly"
  fi
  alert "Image update to $short${revision:+ ($revision)} failed and was rolled back to the previous image. The database was not rolled back."
  heartbeat fail
  exit 1
}

# The image that runs now stays as the way back.
if docker image inspect personal-ops:local >/dev/null 2>&1; then docker tag personal-ops:local personal-ops:previous; fi
docker tag "$IMAGE@$digest" personal-ops:local
log "starting $short"
docker compose up -d || rollback
stays_up || rollback

[ -n "$current" ] && echo "$current" > "$STATE/previous"
echo "$digest" > "$STATE/current"
rm -f "$STATE/rejected"
log "updated to $short${revision:+ ($revision)}"
alert "Updated to image $short${revision:+ (commit $revision)}."
heartbeat ok
