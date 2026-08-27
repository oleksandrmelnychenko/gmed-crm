#!/usr/bin/env bash
# Fast, ad-hoc DEV deployment from a workstation snapshot.
#
# `scripts/publish-dev-current.ps1` uploads both the source archive and this
# runner. The DEV host builds with its persistent Docker cache, swaps the
# release tree only after a successful build, and rolls back automatically if
# startup or the external health check fails. This path is intentionally DEV
# only; production continues to use signed, digest-pinned release images.

set -euo pipefail

ARCHIVE="${1:-/home/gmed/deploy/gmed-crm-current.tgz}"
REPO_DIR="${REPO_DIR:-/home/gmed/gmed-crm}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/gmed/deploy}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
FAILED_DIR="${FAILED_DIR:-$DEPLOY_DIR/failed}"
RELEASE_ENV="${RELEASE_ENV:-$REPO_DIR/release.env}"
CADDY_HOSTNAME_VALUE="${CADDY_HOSTNAME_VALUE:-console-dev.gmed-health.com}"
GMED_CORS_ORIGIN_VALUE="${GMED_CORS_ORIGIN_VALUE:-https://console-dev.gmed-health.com,https://localhost,capacitor://localhost}"
HEALTH_URL="${HEALTH_URL:-https://console-dev.gmed-health.com/health}"
LOG_FILE="${LOG_FILE:-$DEPLOY_DIR/deploy-dev-current.log}"
STAGING_DIR=""
BACKUP_PATH=""
ROLLBACK_OVERRIDE=""
SWAPPED=0
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

compose() {
  docker compose \
    --project-name gmed-crm \
    --env-file "$1/release.env" \
    -f "$1/docker-compose.yml" \
    -f "$1/docker-compose.release.yml" \
    -f "$1/docker-compose.hetzner.yml" \
    -f "$1/docker-compose.dev-hetzner.yml" \
    "${@:2}"
}

finish() {
  local rc=$?
  trap - EXIT

  if [[ "$rc" -ne 0 && "$SWAPPED" -eq 1 ]]; then
    local failed_path="$FAILED_DIR/gmed-crm.failed-$STAMP"
    echo "DEV deploy failed; restoring $BACKUP_PATH"
    mv "$REPO_DIR" "$failed_path"
    mv "$BACKUP_PATH" "$REPO_DIR"
    compose "$REPO_DIR" -f "$ROLLBACK_OVERRIDE" up -d --no-build --remove-orphans || true
    echo "Failed release preserved at $failed_path"
  fi

  if [[ -n "${STAGING_DIR:-}" && -d "$STAGING_DIR" ]]; then
    rm -rf -- "$STAGING_DIR"
  fi

  echo "deploy-dev-current finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

mkdir -p "$BACKUP_DIR" "$FAILED_DIR" "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
exec > >(TZ=UTC awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_FILE") 2>&1

echo "deploy-dev-current started archive=$ARCHIVE repo=$REPO_DIR"

archive_real="$(realpath -m "$ARCHIVE")"
repo_real="$(realpath -m "$REPO_DIR")"
case "$archive_real" in
  /home/gmed/deploy/*.tgz) ;;
  *)
    echo "ERROR: refusing unexpected archive path: $archive_real" >&2
    exit 1
    ;;
esac
case "$repo_real" in
  /home/gmed/*) ;;
  *)
    echo "ERROR: refusing unexpected release path: $repo_real" >&2
    exit 1
    ;;
esac

if [[ ! -f "$archive_real" ]]; then
  echo "ERROR: archive not found: $archive_real" >&2
  exit 1
fi
if [[ ! -f "$RELEASE_ENV" ]]; then
  echo "ERROR: $RELEASE_ENV must exist before publishing DEV." >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d "$DEPLOY_DIR/gmed-crm-release.XXXXXX")"
tar -xzf "$archive_real" -C "$STAGING_DIR"

for required_path in Cargo.toml frontend docker-compose.dev-hetzner.yml; do
  if [[ ! -e "$STAGING_DIR/$required_path" ]]; then
    echo "ERROR: archive is missing $required_path" >&2
    exit 1
  fi
done

cp "$RELEASE_ENV" "$STAGING_DIR/release.env"
chmod 600 "$STAGING_DIR/release.env"

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$STAGING_DIR/release.env"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$STAGING_DIR/release.env"
  else
    printf '%s=%s\n' "$key" "$value" >> "$STAGING_DIR/release.env"
  fi
}

upsert_env CADDY_HOSTNAME "$CADDY_HOSTNAME_VALUE"
upsert_env GMED_CORS_ORIGIN "$GMED_CORS_ORIGIN_VALUE"

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
  if ! grep -q "^${key}=" "$STAGING_DIR/release.env"; then
    echo "ERROR: release.env is missing required key: $key" >&2
    exit 1
  fi
done

compose "$STAGING_DIR" config >/dev/null

ROLLBACK_OVERRIDE="$DEPLOY_DIR/docker-compose.rollback-$STAMP.yml"
tag_running_image() {
  local container="$1"
  local tag="$2"
  local image_id
  image_id="$(docker inspect --format '{{.Image}}' "$container")"
  if docker image inspect "$image_id" >/dev/null 2>&1; then
    docker image tag "$image_id" "$tag"
  else
    # A local rebuild can replace the Compose tag and prune the immutable
    # image object while its old container is still running. Preserve that
    # exact running filesystem as the rollback image instead of aborting the
    # deployment before staging starts.
    docker commit "$container" "$tag" >/dev/null
  fi
}

tag_running_image gmed-crm-backend-1 "gmed-dev-rollback-backend:$STAMP"
tag_running_image gmed-crm-frontend-1 "gmed-dev-rollback-frontend:$STAMP"
tag_running_image gmed-crm-clinical-document-parser-1 "gmed-dev-rollback-parser:$STAMP"
{
  printf 'services:\n'
  printf '  backend:\n    image: gmed-dev-rollback-backend:%s\n' "$STAMP"
  printf '  frontend:\n    image: gmed-dev-rollback-frontend:%s\n' "$STAMP"
  printf '  clinical-document-parser:\n    image: gmed-dev-rollback-parser:%s\n' "$STAMP"
} > "$ROLLBACK_OVERRIDE"

echo "Building DEV images with the host Docker cache..."
export COMPOSE_BAKE=true
compose "$STAGING_DIR" build backend frontend clinical-document-parser
unset COMPOSE_BAKE

BACKUP_PATH="$BACKUP_DIR/gmed-crm.before-$STAMP"
mv "$REPO_DIR" "$BACKUP_PATH"
mv "$STAGING_DIR" "$REPO_DIR"
STAGING_DIR=""
SWAPPED=1

compose "$REPO_DIR" up -d --no-build --remove-orphans

healthy=0
for _attempt in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" -ne 1 ]]; then
  echo "ERROR: DEV health check failed: $HEALTH_URL" >&2
  exit 1
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$DEPLOY_DIR/deploy-dev-current.last"
compose "$REPO_DIR" ps

echo "DEV deploy complete; rollback backup: $BACKUP_PATH"
SWAPPED=0
