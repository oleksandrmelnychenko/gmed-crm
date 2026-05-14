#!/usr/bin/env bash
# Manual deploy for the monitoring stack on the dedicated cax11.
#
# Sibling of `scripts/deploy-prod.sh` with different secret bundle
# path and compose stack. The two scripts intentionally do NOT share
# code — they will diverge (different exporters, different cron jobs,
# different image-verification policies) and a shared library would
# couple the rollouts.
#
# Preconditions (one-time after `terraform apply`):
#   1. SCP the monitoring age private key to /etc/gmed/age.key
#      (mode 600 root:root). DIFFERENT key from PROD.
#   2. Clone the repo to /opt/gmed/repo (depth-50 is fine).
#
# Run from the repo root via sudo. Idempotent — re-running on a
# healthy host is a `git pull` plus a compose reconciliation.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/gmed/repo}"
RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/monitoring.env}"
AGE_KEY_FILE="${AGE_KEY_FILE:-/etc/gmed/age.key}"
SECRETS_PATH="${SECRETS_PATH:-infra/terraform/environments/monitoring-hetzner/secrets.sops.yaml}"
GIT_BRANCH="${GIT_BRANCH:-main}"
LOG_FILE="${LOG_FILE:-/var/log/gmed-monitoring-deploy.log}"
TMP_ENV=""

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: deploy-monitoring.sh must be run as root (sudo)." >&2
  exit 1
fi

install -d -m 755 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"
exec > >(TZ=UTC awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_FILE") 2>&1

finish() {
  local rc=$?
  trap - EXIT
  if [[ -n "${TMP_ENV:-}" ]]; then
    rm -f "$TMP_ENV" || true
  fi
  echo "deploy-monitoring finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

echo "deploy-monitoring started branch=$GIT_BRANCH repo=$REPO_DIR"

for path in "$REPO_DIR/.git" "$AGE_KEY_FILE"; do
  if [[ ! -e "$path" ]]; then
    echo "ERROR: $path missing. See script header for first-time setup." >&2
    exit 1
  fi
done

cd "$REPO_DIR"
git fetch origin "$GIT_BRANCH"
git checkout "$GIT_BRANCH"
git reset --hard "origin/$GIT_BRANCH"

# Atomic decrypt to a fresh env file.
TMP_ENV="$(mktemp -p "$(dirname "$RELEASE_ENV")" monitoring.env.XXXXXX)"

SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" \
  sops -d --output-type dotenv "$REPO_DIR/$SECRETS_PATH" > "$TMP_ENV"

required_keys=(
  TAILSCALE_AUTH_KEY
  TAILSCALE_HOSTNAME
  GRAFANA_ADMIN_PASSWORD
  GRAFANA_SECRET_KEY
  ALERTMANAGER_SMTP_HOST
  ALERTMANAGER_SMTP_FROM
  ALERTMANAGER_SMTP_USERNAME
  ALERTMANAGER_SMTP_PASSWORD
  ALERTMANAGER_TO_EMAIL
)
for key in "${required_keys[@]}"; do
  if ! grep -q "^${key}=" "$TMP_ENV"; then
    echo "ERROR: secrets.sops.yaml is missing required key: $key" >&2
    exit 1
  fi
done

install -m 600 "$TMP_ENV" "$RELEASE_ENV"

set -a
# shellcheck disable=SC1090
. "$RELEASE_ENV"
set +a

# Tailscale: bring up the daemon if not running. Same idempotent
# pattern as deploy-prod.sh.
if command -v tailscale >/dev/null 2>&1; then
  if ! tailscale status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
    echo "Bringing up Tailscale"
    HOSTNAME_FLAG=""
    if [[ -n "${TAILSCALE_HOSTNAME:-}" ]]; then
      HOSTNAME_FLAG="--hostname=${TAILSCALE_HOSTNAME}"
    fi
    tailscale up \
      --authkey="$TAILSCALE_AUTH_KEY" \
      $HOSTNAME_FLAG \
      --accept-routes=false \
      --accept-dns=false \
      --ssh=false
    echo "Tailscale: $(tailscale ip -4 2>/dev/null || echo 'pending')"
  fi
fi

# Healthchecks.io ping cron — pings every 5 minutes so a dead
# monitoring host alerts via Healthchecks.io's own channels.
if [[ -n "${MONITORING_HEALTHCHECKS_PING_URL:-}" ]]; then
  install -d -m 755 /etc/cron.d
  cat > /etc/cron.d/gmed-monitoring-ping <<EOF
# Auto-installed by deploy-monitoring.sh. Pings Healthchecks.io if
# Prometheus is healthy (proxies "the monitoring host is up").
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root curl -fsS --max-time 10 http://127.0.0.1:9090/-/healthy >/dev/null 2>&1 && curl -fsS --retry 3 --max-time 10 "$MONITORING_HEALTHCHECKS_PING_URL" >/dev/null 2>&1
EOF
  chmod 600 /etc/cron.d/gmed-monitoring-ping
fi

# Bring (or keep) the monitoring stack up.
docker compose \
  --env-file "$RELEASE_ENV" \
  -f monitoring/docker-compose.yml \
  up -d --remove-orphans

docker image prune -f --filter "until=24h"

date -u +%Y-%m-%dT%H:%M:%SZ > /etc/gmed/deploy-monitoring.last
echo "Monitoring deploy complete."
