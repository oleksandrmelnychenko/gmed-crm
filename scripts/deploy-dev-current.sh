#!/usr/bin/env bash
# Deploy the currently uploaded DEV archive on the Hetzner DEV host.
#
# This script is for ad-hoc DEV deployments from a local working tree:
#   1. Upload a tarball to /home/gmed/deploy/gmed-crm-current.tgz.
#   2. Run this script on the DEV host as the gmed user.
#
# It intentionally does not require root. The gmed user is in the docker
# group on the Terraform-provisioned host.

set -euo pipefail

ARCHIVE="${1:-/home/gmed/deploy/gmed-crm-current.tgz}"
REPO_DIR="${REPO_DIR:-/home/gmed/gmed-crm}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/gmed/deploy}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
RELEASE_ENV="${RELEASE_ENV:-$REPO_DIR/release.env}"
CADDY_HOSTNAME_VALUE="${CADDY_HOSTNAME_VALUE:-console-dev.gmed-health.com}"
GMED_CORS_ORIGIN_VALUE="${GMED_CORS_ORIGIN_VALUE:-https://console-dev.gmed-health.com}"
LOG_FILE="${LOG_FILE:-$DEPLOY_DIR/deploy-dev-current.log}"

mkdir -p "$REPO_DIR" "$BACKUP_DIR" "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

exec > >(TZ=UTC awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_FILE") 2>&1

echo "deploy-dev-current started archive=$ARCHIVE repo=$REPO_DIR"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "ERROR: archive not found: $ARCHIVE" >&2
  exit 1
fi

if [[ -f "$RELEASE_ENV" ]]; then
  backup="$BACKUP_DIR/release.env.$(date -u +%Y%m%d%H%M%S)"
  cp "$RELEASE_ENV" "$backup"
  chmod 600 "$backup"
  echo "release.env backup: $backup"
fi

tar -xzf "$ARCHIVE" -C "$REPO_DIR"

if [[ ! -f "$RELEASE_ENV" ]]; then
  echo "ERROR: $RELEASE_ENV missing after extraction." >&2
  exit 1
fi

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$RELEASE_ENV"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$RELEASE_ENV"
  else
    printf '%s=%s\n' "$key" "$value" >> "$RELEASE_ENV"
  fi
}

upsert_env "CADDY_HOSTNAME" "$CADDY_HOSTNAME_VALUE"
upsert_env "GMED_CORS_ORIGIN" "$GMED_CORS_ORIGIN_VALUE"
chmod 600 "$RELEASE_ENV"

required_keys=(
  GMED_DATABASE_URL
  GMED_JWT_SECRET
  GMED_MESSAGE_ENCRYPTION_KEYS
  GMED_MESSAGE_ENCRYPTION_KEY_ACTIVE
  GMED_AUDIT_IP_SALT
  GMED_CORS_ORIGIN
  GMED_LEAD_INTAKE_TOKEN
  CADDY_HOSTNAME
  ACME_EMAIL
)
for key in "${required_keys[@]}"; do
  if ! grep -q "^${key}=" "$RELEASE_ENV"; then
    echo "ERROR: $RELEASE_ENV is missing required key: $key" >&2
    exit 1
  fi
done

cd "$REPO_DIR"

echo "Public runtime env:"
grep -E '^(CADDY_HOSTNAME|GMED_CORS_ORIGIN|ACME_EMAIL)=' "$RELEASE_ENV"

docker compose \
  --env-file "$RELEASE_ENV" \
  -f docker-compose.yml \
  -f docker-compose.release.yml \
  -f docker-compose.hetzner.yml \
  config >/dev/null

docker compose \
  --env-file "$RELEASE_ENV" \
  -f docker-compose.yml \
  -f docker-compose.release.yml \
  -f docker-compose.hetzner.yml \
  up -d --build --remove-orphans

docker image prune -f --filter "until=24h"

date -u +%Y-%m-%dT%H:%M:%SZ > "$DEPLOY_DIR/deploy-dev-current.last"

docker compose \
  --env-file "$RELEASE_ENV" \
  -f docker-compose.yml \
  -f docker-compose.release.yml \
  -f docker-compose.hetzner.yml \
  ps

echo "deploy-dev-current complete."
