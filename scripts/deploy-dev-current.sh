#!/usr/bin/env bash
# Fast, ad-hoc DEV deployment from a workstation snapshot.
#
# `scripts/publish-dev-current.ps1` uploads both the source archive and this
# runner. The DEV host builds with its persistent Docker cache, swaps the
# release tree only after a successful build, and rolls back automatically if
# startup or the external health check fails. This path is intentionally DEV
# only; production continues to use signed, digest-pinned release images.
# An optional second argument supplies four signed DEV image pins instead of
# building on the host. Both modes rehearse migrations on a backup clone first.
# The publisher runs this entire script under /home/gmed/deploy/deploy.lock.
# Direct callers must acquire that same lock before building shared image tags.

set -euo pipefail

ARCHIVE="${1:-/home/gmed/deploy/gmed-crm-current.tgz}"
IMAGE_PINS_FILE="${2:-}"
REPO_DIR="${REPO_DIR:-/home/gmed/gmed-crm}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/gmed/deploy}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
FAILED_DIR="${FAILED_DIR:-$DEPLOY_DIR/failed}"
RELEASE_ENV="${RELEASE_ENV:-$REPO_DIR/release.env}"
CADDY_HOSTNAME_VALUE="${CADDY_HOSTNAME_VALUE:-console-dev.gmed-health.com}"
GMED_CORS_ORIGIN_VALUE="${GMED_CORS_ORIGIN_VALUE:-https://console-dev.gmed-health.com,https://localhost,capacitor://localhost}"
HEALTH_URL="${HEALTH_URL:-https://console-dev.gmed-health.com/health}"
LOG_FILE="${LOG_FILE:-$DEPLOY_DIR/deploy-dev-current.log}"
# DEV uses dev-fast with one Cargo job instead of release/LTO. Retain the RAM
# guard and OCR recovery even with the lower-memory compiler profile.
BUILD_MEMORY_HEADROOM_MB="${BUILD_MEMORY_HEADROOM_MB:-6144}"
BUILD_MEMORY_ABORT_MB="${BUILD_MEMORY_ABORT_MB:-768}"
BUILD_PID=""
STOPPED_OCR_CONTAINERS=()
STAGING_DIR=""
BACKUP_PATH=""
ROLLBACK_OVERRIDE=""
SWAPPED=0
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

compose() {
  local image_options=()
  if [[ -f "$1/.release-images.pins" ]]; then
    image_options=(--env-file "$1/.release-images.pins" -f "$1/docker-compose.ghcr.yml")
  fi
  docker compose \
    --project-name gmed-crm \
    --env-file "$1/release.env" \
    -f "$1/docker-compose.yml" \
    -f "$1/docker-compose.release.yml" \
    -f "$1/docker-compose.hetzner.yml" \
    -f "$1/docker-compose.dev-hetzner.yml" \
    "${image_options[@]}" \
    "${@:2}"
}

verify_dev_image_pins() {
  local file="$1" line key ref expected count=0
  local -A seen=()
  command -v "${COSIGN_BIN:-cosign}" >/dev/null || {
    echo "ERROR: cosign is required to deploy registry images." >&2
    return 1
  }
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    ref="${line#*=}"
    case "$key" in
      GMED_BACKEND_IMAGE) expected=gmed-crm-server ;;
      GMED_FRONTEND_IMAGE) expected=gmed-crm-frontend ;;
      GMED_PARSER_IMAGE) expected=gmed-crm-clinical-document-parser ;;
      GMED_INVOICE_PARSER_IMAGE) expected=gmed-crm-invoice-parser ;;
      *) echo "ERROR: unexpected image pin key." >&2; return 1 ;;
    esac
    if [[ -n "${seen[$key]:-}" ||
          ! "$ref" =~ ^ghcr\.io/oleksandrmelnychenko/${expected}@sha256:[a-f0-9]{64}$ ]]; then
      echo "ERROR: invalid or duplicate image pin for $key." >&2
      return 1
    fi
    seen[$key]="$ref"
    count=$((count + 1))
  done < "$file"
  if [[ "$count" -ne 4 ]]; then
    echo "ERROR: all four DEV image digests are required." >&2
    return 1
  fi
  for key in GMED_BACKEND_IMAGE GMED_FRONTEND_IMAGE GMED_PARSER_IMAGE GMED_INVOICE_PARSER_IMAGE; do
    "${COSIGN_BIN:-cosign}" verify \
      --certificate-identity https://github.com/oleksandrmelnychenko/gmed-crm/.github/workflows/dev.yml@refs/heads/main \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com \
      "${seen[$key]}" >/dev/null || return 1
  done
}

prepare_upload_volume() {
  compose "$1" run --rm --no-deps \
    --user 0:0 \
    --entrypoint /usr/local/bin/gmed-prepare-uploads \
    backend
}

available_memory_mb() {
  local available
  available="$(awk '$1 == "MemAvailable:" { print int($2 / 1024) }' /proc/meminfo)"
  if [[ ! "$available" =~ ^[0-9]+$ ]]; then
    echo "ERROR: cannot read available host RAM." >&2
    return 1
  fi
  printf '%s\n' "$available"
}

pause_ocr_for_build() {
  local container running
  for container in gmed-crm-clinical-document-parser-1 gmed-crm-invoice-parser-1; do
    running="$(docker inspect --format '{{.State.Running}}' "$container")" || return 1
    if [[ "$running" == "true" ]]; then
      # Record before stopping so a partial stop failure is recovered by EXIT.
      STOPPED_OCR_CONTAINERS+=("$container")
      echo "Temporarily stopping $container to leave RAM for the DEV build."
      docker stop --timeout 20 "$container" || return 1
    fi
  done
}

restore_ocr_after_build() {
  local container running failed=0
  for container in "${STOPPED_OCR_CONTAINERS[@]}"; do
    running="$(docker inspect --format '{{.State.Running}}' "$container")" || running=false
    if [[ "$running" != "true" ]]; then
      echo "Restoring $container after the DEV build."
      docker start "$container" || failed=1
    fi
  done
  return "$failed"
}

stop_active_build() {
  if [[ -n "$BUILD_PID" ]]; then
    # Each build owns a process group: terminate the Compose client and its
    # children, so BuildKit cancels the compiler before OCR is restarted.
    kill -TERM -- "-$BUILD_PID" 2>/dev/null || kill -TERM "$BUILD_PID" 2>/dev/null || true
    wait "$BUILD_PID" 2>/dev/null || true
    BUILD_PID=""
  fi
}

build_with_memory_guard() {
  local directory="$1" available result
  shift
  available="$(available_memory_mb)" || return 1
  echo "Available RAM before building $*: ${available} MiB."
  if (( available < BUILD_MEMORY_HEADROOM_MB )); then
    pause_ocr_for_build || return 1
  fi
  available="$(available_memory_mb)" || return 1
  if (( available < BUILD_MEMORY_ABORT_MB )); then
    echo "ERROR: insufficient RAM even with OCR stopped (${available} MiB); DEV build cancelled." >&2
    return 1
  fi

  # A separate session lets EXIT/INT/TERM and low-memory cancellation stop the
  # entire build command without signalling this deployment or the live API.
  setsid docker compose --project-name gmed-crm --env-file "$directory/release.env" \
    -f "$directory/docker-compose.yml" -f "$directory/docker-compose.release.yml" \
    -f "$directory/docker-compose.hetzner.yml" -f "$directory/docker-compose.dev-hetzner.yml" \
    build "$@" &
  BUILD_PID=$!
  while kill -0 "$BUILD_PID" 2>/dev/null; do
    sleep 2
    kill -0 "$BUILD_PID" 2>/dev/null || break
    available="$(available_memory_mb)" || return 1
    if (( available < BUILD_MEMORY_ABORT_MB * 2 )); then
      pause_ocr_for_build || return 1
      available="$(available_memory_mb)" || return 1
      if (( available < BUILD_MEMORY_ABORT_MB )); then
        echo "ERROR: available RAM fell to ${available} MiB; cancelling the build to keep DEV responsive." >&2
        stop_active_build
        return 1
      fi
    fi
  done
  if wait "$BUILD_PID"; then result=0; else result=$?; fi
  BUILD_PID=""
  return "$result"
}

finish() {
  local rc=$?
  trap - EXIT INT TERM HUP
  set +e
  stop_active_build

  if [[ "$rc" -ne 0 && "$SWAPPED" -eq 1 ]]; then
    local failed_path="$FAILED_DIR/gmed-crm.failed-$STAMP"
    echo "DEV deploy failed; restoring $BACKUP_PATH"
    mv "$REPO_DIR" "$failed_path"
    mv "$BACKUP_PATH" "$REPO_DIR"
    compose "$REPO_DIR" -f "$ROLLBACK_OVERRIDE" up -d --no-build --remove-orphans || true
    echo "Failed release preserved at $failed_path"
  fi

  if ! restore_ocr_after_build; then
    echo "ERROR: an OCR service could not be restored; check docker ps -a." >&2
    rc=1
  fi

  if [[ -n "${STAGING_DIR:-}" && -d "$STAGING_DIR" ]]; then
    rm -rf -- "$STAGING_DIR"
  fi

  echo "deploy-dev-current finished rc=$rc"
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

mkdir -p "$BACKUP_DIR" "$FAILED_DIR" "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
exec > >(TZ=UTC awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_FILE") 2>&1

echo "deploy-dev-current started archive=$ARCHIVE repo=$REPO_DIR"

if [[ ! "$BUILD_MEMORY_HEADROOM_MB" =~ ^[1-9][0-9]*$ ||
      ! "$BUILD_MEMORY_ABORT_MB" =~ ^[1-9][0-9]*$ ]] ||
   (( BUILD_MEMORY_HEADROOM_MB < BUILD_MEMORY_ABORT_MB * 2 )); then
  echo "ERROR: build RAM thresholds must be positive MiB values; headroom must be at least twice the abort threshold." >&2
  exit 1
fi
command -v setsid >/dev/null

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
tar --same-permissions -xzf "$archive_real" -C "$STAGING_DIR"

for required_path in Cargo.toml frontend docker-compose.dev-hetzner.yml; do
  if [[ ! -e "$STAGING_DIR/$required_path" ]]; then
    echo "ERROR: archive is missing $required_path" >&2
    exit 1
  fi
done

cp "$RELEASE_ENV" "$STAGING_DIR/release.env"
chmod 600 "$STAGING_DIR/release.env"

if [[ -n "$IMAGE_PINS_FILE" ]]; then
  pins_real="$(realpath -m "$IMAGE_PINS_FILE")"
  case "$pins_real" in
    /home/gmed/deploy/*.pins) ;;
    *) echo "ERROR: refusing unexpected image pins path." >&2; exit 1 ;;
  esac
  verify_dev_image_pins "$pins_real"
  cp "$pins_real" "$STAGING_DIR/.release-images.pins"
fi

# Keep the optional public model archive across source-only releases. The image
# build verifies its pinned checksum before using it, so an unavailable model
# download host does not block subsequent DEV deployments.
model_archive="services/clinical-document-parser/translation-model.argosmodel"
if [[ -f "$REPO_DIR/$model_archive" ]]; then
  cp "$REPO_DIR/$model_archive" "$STAGING_DIR/$model_archive"
fi

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

# Generate the internal OCR credential on DEV, never in the browser bundle.
if ! grep -q '^GMED_INVOICE_PARSER_API_KEY=.' "$STAGING_DIR/release.env"; then
  upsert_env GMED_INVOICE_PARSER_API_KEY "$(openssl rand -hex 32)"
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
  local fallback_image="$3"
  local image_id
  image_id="$(docker inspect --format '{{.Image}}' "$container")"
  if docker image inspect "$image_id" >/dev/null 2>&1; then
    docker image tag "$image_id" "$tag"
  else
    # A local rebuild can replace the Compose tag and prune the immutable
    # image object while its old container is still running. Preserve that
    # exact running filesystem as the rollback image instead of aborting the
    # deployment before staging starts.
    if ! docker commit "$container" "$tag" >/dev/null 2>&1; then
      # Some BuildKit/Garbage Collection combinations can also remove a
      # content layer referenced by the live container. Fall back to the
      # latest successfully built Compose image, which is still a bootable
      # rollback target and leaves the running service untouched.
      docker image inspect "$fallback_image" >/dev/null
      docker image tag "$fallback_image" "$tag"
    fi
  fi
}

tag_running_image gmed-crm-backend-1 "gmed-dev-rollback-backend:$STAMP" gmed-crm-backend
tag_running_image gmed-crm-frontend-1 "gmed-dev-rollback-frontend:$STAMP" gmed-crm-frontend
tag_running_image gmed-crm-clinical-document-parser-1 "gmed-dev-rollback-parser:$STAMP" gmed-crm-clinical-document-parser
tag_running_image gmed-crm-invoice-parser-1 "gmed-dev-rollback-invoice-parser:$STAMP" gmed-crm-invoice-parser
{
  printf 'services:\n'
  printf '  backend:\n    image: gmed-dev-rollback-backend:%s\n    pull_policy: never\n' "$STAMP"
  printf '  frontend:\n    image: gmed-dev-rollback-frontend:%s\n    pull_policy: never\n' "$STAMP"
  printf '  clinical-document-parser:\n    image: gmed-dev-rollback-parser:%s\n    pull_policy: never\n' "$STAMP"
  printf '  invoice-parser:\n    image: gmed-dev-rollback-invoice-parser:%s\n    pull_policy: never\n' "$STAMP"
} > "$ROLLBACK_OVERRIDE"

if [[ -n "$IMAGE_PINS_FILE" ]]; then
  echo "Pulling four verified DEV images; no server-side build..."
  compose "$STAGING_DIR" pull backend frontend clinical-document-parser invoice-parser
else
  echo "Building DEV images with the host Docker cache..."
  export COMPOSE_BAKE=true
  # Do not overlap Vite/OCR image builds with Rust's peak release/LTO memory use.
  build_with_memory_guard "$STAGING_DIR" backend
  build_with_memory_guard "$STAGING_DIR" frontend clinical-document-parser invoice-parser
  unset COMPOSE_BAKE
fi

# Always rehearse against a fresh backup, including the fast source-build path.
# The live database is changed only by the new backend after this succeeds.
(
  export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  POSTGRES_USER="$(docker exec gmed-postgres printenv POSTGRES_USER)"
  POSTGRES_PASSWORD="$(docker exec gmed-postgres printenv POSTGRES_PASSWORD)"
  POSTGRES_DB="$(docker exec gmed-postgres printenv POSTGRES_DB)"
  python3 "$STAGING_DIR/scripts/preflight-prod-migrations.py" \
    --migrations "$STAGING_DIR/migrations" \
    --backup-dir "$BACKUP_DIR/database-$STAMP"
)
prepare_upload_volume "$STAGING_DIR"

BACKUP_PATH="$BACKUP_DIR/gmed-crm.before-$STAMP"
mv "$REPO_DIR" "$BACKUP_PATH"
mv "$STAGING_DIR" "$REPO_DIR"
STAGING_DIR=""
SWAPPED=1

# Start the data and API tier first. The frontend declares a healthy-backend
# dependency, and asking Compose to start everything at once can fail before
# the backend's migrations and first health probe have had time to complete.
compose "$REPO_DIR" up -d --no-build postgres clinical-document-parser invoice-parser backend

backend_healthy=0
# Migrations and the first ClamAV-backed startup can occasionally take longer
# than one minute on the DEV host. Keep the old release serving while allowing
# the staged backend up to three minutes to pass its first health probe.
for _attempt in $(seq 1 90); do
  backend_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' gmed-crm-backend-1)"
  if [[ "$backend_status" == "healthy" ]]; then
    backend_healthy=1
    break
  fi
  if [[ "$backend_status" == "exited" || "$backend_status" == "dead" ]]; then
    docker logs --tail 120 gmed-crm-backend-1 >&2 || true
    break
  fi
  sleep 2
done
if [[ "$backend_healthy" -ne 1 ]]; then
  echo "ERROR: DEV backend did not become healthy." >&2
  exit 1
fi

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
