#!/usr/bin/env bash
# Manual deploy script for DEV on Hetzner.
#
# Run on the DEV host as root:
#   sudo bash /opt/gmed/repo/scripts/deploy-dev.sh
#
# Preconditions:
#   - Docker and git are installed.
#   - /opt/gmed/repo is a clone of this repository.
#   - Either /opt/gmed/release.env already exists, or sops + age are
#     installed and /etc/gmed/age.key can decrypt the DEV secrets bundle.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/gmed/repo}"
RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
AGE_KEY_FILE="${AGE_KEY_FILE:-/etc/gmed/age.key}"
SECRETS_PATH="${SECRETS_PATH:-infra/terraform/environments/dev-hetzner/secrets.sops.yaml}"
GIT_BRANCH="${GIT_BRANCH:-main}"
LOG_FILE="${LOG_FILE:-/var/log/gmed-dev-deploy.log}"
TMP_ENV=""

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: deploy-dev.sh must be run as root (sudo)." >&2
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
  echo "deploy-dev finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

echo "deploy-dev started branch=$GIT_BRANCH repo=$REPO_DIR"

for path in "$REPO_DIR/.git"; do
  if [[ ! -e "$path" ]]; then
    echo "ERROR: $path missing." >&2
    exit 1
  fi
done

cd "$REPO_DIR"
git fetch origin "$GIT_BRANCH"
git checkout "$GIT_BRANCH"
git reset --hard "origin/$GIT_BRANCH"

if [[ -f "$REPO_DIR/$SECRETS_PATH" ]]; then
  if [[ ! -f "$AGE_KEY_FILE" ]]; then
    echo "ERROR: $AGE_KEY_FILE missing; cannot decrypt $SECRETS_PATH." >&2
    exit 1
  fi

  TMP_ENV="$(mktemp -p "$(dirname "$RELEASE_ENV")" release.env.XXXXXX)"

  SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" \
    sops -d --output-type dotenv "$REPO_DIR/$SECRETS_PATH" > "$TMP_ENV"

  install -m 600 "$TMP_ENV" "$RELEASE_ENV"
elif [[ ! -f "$RELEASE_ENV" ]]; then
  echo "ERROR: neither $REPO_DIR/$SECRETS_PATH nor $RELEASE_ENV exists." >&2
  exit 1
fi

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

env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$RELEASE_ENV" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi
  printf '%s' "${line#*=}" \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

backend_image="$(env_value GMED_BACKEND_IMAGE)"
frontend_image="$(env_value GMED_FRONTEND_IMAGE)"

compose_args=(
  --env-file "$RELEASE_ENV"
  -f docker-compose.yml
  -f docker-compose.release.yml
  -f docker-compose.hetzner.yml
  -f docker-compose.dev-hetzner.yml
)

if [[ -n "$backend_image" || -n "$frontend_image" ]]; then
  if [[ -z "$backend_image" || -z "$frontend_image" ]]; then
    echo "ERROR: set both GMED_BACKEND_IMAGE and GMED_FRONTEND_IMAGE, or leave both empty for local build." >&2
    exit 1
  fi
  for image in "$backend_image" "$frontend_image"; do
    if [[ "$image" != *"@sha256:"* ]]; then
      echo "ERROR: DEV image pins must be digest-pinned (@sha256:...). Got: $image" >&2
      exit 1
    fi
  done

  echo "Deploying DEV from prebuilt GHCR images"
  docker compose "${compose_args[@]}" -f docker-compose.ghcr.yml pull backend frontend
  docker compose "${compose_args[@]}" -f docker-compose.ghcr.yml up -d --remove-orphans
else
  echo "Deploying DEV from local host build"
  docker compose "${compose_args[@]}" up -d --build --remove-orphans
fi

docker image prune -f --filter "until=24h"

date -u +%Y-%m-%dT%H:%M:%SZ > /etc/gmed/deploy-dev.last
echo "DEV deploy complete."
