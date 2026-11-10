#!/usr/bin/env bash
# Manual deploy script for PROD.
#
# On PROD the age private key is NOT in TF state — Terraform brings the
# server up and stops at the hardened-OS stage. The first deploy and
# every subsequent redeploy are driven by this script, run on the host
# as root (via sudo).
#
# Preconditions (set up once after `terraform apply`):
#   1. SCP the age private key to the host:
#        scp /path/to/prod.key gmed@console.gmed-health.com:/tmp/age.key
#   2. Install it:
#        ssh gmed@console.gmed-health.com
#        sudo install -o root -g root -m 600 /tmp/age.key /etc/gmed/age.key
#        shred -u /tmp/age.key
#   3. Clone the repo:
#        sudo install -d -o root -g root -m 755 /opt/gmed
#        sudo git clone --depth 50 \
#          https://github.com/oleksandrmelnychenko/gmed-crm.git \
#          /opt/gmed/repo
#
# After that, run this script for every deploy:
#   sudo /opt/gmed/repo/scripts/deploy-prod.sh
#
# It is intentionally idempotent — re-running it on a healthy host is a
# no-op apart from a pull and a compose reconciliation.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/gmed/repo}"
RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
AGE_KEY_FILE="${AGE_KEY_FILE:-/etc/gmed/age.key}"
SECRETS_PATH="${SECRETS_PATH:-infra/terraform/environments/prod-hetzner/secrets.sops.yaml}"
IMAGE_PINS_PATH="${IMAGE_PINS_PATH:-infra/terraform/environments/prod-hetzner/release-images.pins}"
GIT_BRANCH="${GIT_BRANCH:-main}"
LOG_FILE="${LOG_FILE:-/var/log/gmed-deploy.log}"
TMP_ENV=""
IMPORT_BOOTSTRAP_DIRECTORY=false
UPGRADE_ONLY=false

if [[ "$#" -gt 1 ]]; then
  echo "ERROR: deploy-prod.sh accepts at most one argument." >&2
  exit 1
fi
if [[ "${1:-}" == "--import-bootstrap-directory" ]]; then
  IMPORT_BOOTSTRAP_DIRECTORY=true
elif [[ "${1:-}" == "--upgrade-only" ]]; then
  UPGRADE_ONLY=true
elif [[ "$#" -eq 1 ]]; then
  echo "ERROR: unsupported deploy-prod.sh argument: $1" >&2
  exit 1
fi

# cosign verification anchor. ANY image we run must be signed by the
# release workflow in THIS repository — Sigstore Fulcio's certificate
# embeds the workflow identity, so the regex below is the trust
# anchor. Update the owner/repo if the repository moves.
#
# The identity is limited to the two refs the Release Build workflow is
# really started from: a pushed version tag (`v*`, the documented procedure)
# and a manual `workflow_dispatch` on main (still enabled in release.yml and
# the origin of images built before 2026-10-26). A run from any other branch
# or from a pull request ref no longer verifies.
#
# Both values are fixed HERE, from the operator's own environment, before
# release.env or the image pins file is read, and kept in readonly variables
# that nothing below assigns: neither file can widen the trust anchor.
readonly cosign_cert_identity_regexp="${COSIGN_CERT_IDENTITY_REGEXP:-^https://github\.com/oleksandrmelnychenko/gmed-crm/\.github/workflows/release\.yml@refs/(tags/v[0-9A-Za-z._-]+|heads/main)$}"
readonly cosign_oidc_issuer="${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"
# Pinned tool versions with the checksums published by the upstream projects
# (cosign_checksums.txt of the sigstore/cosign release). Changing the version
# means changing the checksums in the same commit.
readonly cosign_version="v2.4.1"
readonly cosign_sha256_amd64="8b24b946dd5809c6bd93de08033bcf6bc0ed7d336b7785787c080f574b89249b"
readonly cosign_sha256_arm64="3b2e2e3854d0356c45fe6607047526ccd04742d20bd44afb5be91fa2a6e7cb4a"
RCLONE_VERSION="${RCLONE_VERSION:-v1.75.0}"

# Run as root: needs to read /etc/gmed/age.key and run `docker compose`.
if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: deploy-prod.sh must be run as root (sudo)." >&2
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
  echo "deploy-prod finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

echo "deploy-prod started branch=$GIT_BRANCH repo=$REPO_DIR"

for path in "$REPO_DIR/.git" "$AGE_KEY_FILE" "$REPO_DIR/$IMAGE_PINS_PATH"; do
  if [[ ! -e "$path" ]]; then
    echo "ERROR: $path missing. See the script header for first-time setup steps." >&2
    exit 1
  fi
done

# Disk space before anything writes (2026-10-23: a full disk kept every
# backend version from starting, while each upgrade added another full
# pg_dump under /var/backups/gmed/releases). Prints what fills the disk and,
# below the threshold, frees only what can be rebuilt or is superseded:
# build cache, unused images, oversized container logs, the journal and
# release backups beyond the newest ones. Volumes (database, uploads) are
# never touched.
MIN_FREE_GB="${MIN_FREE_GB:-20}"
ABORT_FREE_GB="${ABORT_FREE_GB:-5}"
KEEP_RELEASE_BACKUPS="${KEEP_RELEASE_BACKUPS:-10}"
RELEASE_BACKUP_ROOT="/var/backups/gmed/releases"
free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }
disk_report() {
  echo "Disk: $(df -h --output=used,size,pcent / | tail -1)"
  du -xsh /var/lib/docker/volumes /var/lib/docker/overlay2 /var/lib/docker/containers \
    /var/lib/containerd "$RELEASE_BACKUP_ROOT" /var/log 2>/dev/null || true
  if [[ -d "$RELEASE_BACKUP_ROOT" ]]; then
    echo "Release backups: $(find "$RELEASE_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  fi
  docker system df 2>/dev/null || true
}
echo "Free space on /: $(free_gb) GB"
if (( $(free_gb) < MIN_FREE_GB )); then
  echo "Less than ${MIN_FREE_GB} GB free: freeing rebuildable and superseded files."
  disk_report
  docker builder prune -af || true
  docker image prune -af --filter "until=24h" || true
  find /var/lib/docker/containers -name '*-json.log' -size +100M -print -exec truncate -s 0 {} \; 2>/dev/null || true
  journalctl --vacuum-size=200M >/dev/null 2>&1 || true
  if [[ -d "$RELEASE_BACKUP_ROOT" ]]; then
    # Directory names start with the UTC timestamp: newest last.
    mapfile -t old_backups < <(find "$RELEASE_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
      | sort | head -n "-${KEEP_RELEASE_BACKUPS}")
    for name in "${old_backups[@]}"; do
      echo "Removing release backup $name (keeping the newest ${KEEP_RELEASE_BACKUPS})"
      rm -rf -- "${RELEASE_BACKUP_ROOT:?}/$name"
    done
  fi
  disk_report
fi
if (( $(free_gb) < ABORT_FREE_GB )); then
  echo "ERROR: only $(free_gb) GB free on / after the cleanup; not deploying. See the disk report above." >&2
  exit 1
fi

# Every upgrade leaves a full database dump and copies of the environment
# file (all secrets) under RELEASE_BACKUP_ROOT. They are a short-lived way
# back from a failed upgrade, not an archive (the encrypted daily backup is
# the archive), so independent of free disk space only the newest
# RELEASE_BACKUP_KEEP are kept and none older than RELEASE_BACKUP_MAX_AGE_DAYS.
# The backup of the running upgrade is never removed.
RELEASE_BACKUP_KEEP="${RELEASE_BACKUP_KEEP:-5}"
RELEASE_BACKUP_MAX_AGE_DAYS="${RELEASE_BACKUP_MAX_AGE_DAYS:-14}"
if [[ ! "$RELEASE_BACKUP_KEEP" =~ ^[1-9][0-9]*$ || ! "$RELEASE_BACKUP_MAX_AGE_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: RELEASE_BACKUP_KEEP and RELEASE_BACKUP_MAX_AGE_DAYS must be positive whole numbers." >&2
  exit 1
fi

prune_release_backups() {
  local current="$1" name cutoff position=0
  local -a names=()
  [[ -d "$RELEASE_BACKUP_ROOT" ]] || return 0
  cutoff="$(date -u -d "${RELEASE_BACKUP_MAX_AGE_DAYS} days ago" +%Y%m%dT%H%M%SZ)"
  # Directory names start with the UTC timestamp: newest first after sort -r.
  mapfile -t names < <(find "$RELEASE_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
  for name in "${names[@]}"; do
    # Only directories this script created (<UTC timestamp>-<commit>).
    [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]+$ ]] || continue
    position=$((position + 1))
    [[ "$name" == "$current" ]] && continue
    if (( position > RELEASE_BACKUP_KEEP )) || [[ "${name%%-*}" < "$cutoff" ]]; then
      echo "Removing release backup $name (keeping the newest ${RELEASE_BACKUP_KEEP}, none older than ${RELEASE_BACKUP_MAX_AGE_DAYS} days)"
      rm -rf -- "${RELEASE_BACKUP_ROOT:?}/$name"
    fi
  done
}

# After a successful deploy the dump and the files that contain secrets are
# encrypted for the backup recipients (the same public keys as the daily
# backup) and the readable originals are removed. Until then they stay
# readable, so a failed upgrade can be undone at once without the offline
# private key. Later use: `age -d -i <backup private key> <file>.age`.
# Without BACKUP_AGE_RECIPIENTS the files stay as they are (root-only).
# Never fails the deploy: it runs after the new release is healthy.
seal_release_backups() {
  local directory name file
  if [[ -z "${BACKUP_AGE_RECIPIENTS:-}" ]] || ! command -v age >/dev/null 2>&1; then
    echo "Release backups stay unencrypted (root-only): BACKUP_AGE_RECIPIENTS or age is missing."
    return 0
  fi
  [[ -d "$RELEASE_BACKUP_ROOT" ]] || return 0
  while IFS= read -r directory; do
    for name in database-before-upgrade.dump previous-release.env release.env postgres-container.json; do
      file="$directory/$name"
      [[ -f "$file" ]] || continue
      if (umask 077; age -e -R <(printf '%s\n' "$BACKUP_AGE_RECIPIENTS") -o "$file.age.partial" "$file") &&
         [[ -s "$file.age.partial" ]]; then
        mv -f -- "$file.age.partial" "$file.age"
        rm -f -- "$file"
      else
        rm -f -- "$file.age.partial"
        echo "WARN: could not encrypt $file; it stays readable for root only."
        return 0
      fi
    done
  done < <(find "$RELEASE_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d)
  echo "Release backups encrypted for the backup recipients."
}

if [[ "$UPGRADE_ONLY" == "true" ]]; then
  upgrade_backup_name="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"
  upgrade_backup_dir="$RELEASE_BACKUP_ROOT/$upgrade_backup_name"
  # Root-only all the way down: the directory names alone list every release.
  install -d -o root -g root -m 700 "$(dirname "$RELEASE_BACKUP_ROOT")" "$RELEASE_BACKUP_ROOT" "$upgrade_backup_dir"
  install -m 600 "$RELEASE_ENV" "$upgrade_backup_dir/previous-release.env"
  install -m 600 "$REPO_DIR/$IMAGE_PINS_PATH" "$upgrade_backup_dir/previous-images.pins"
  (umask 077; docker ps --format '{{.Names}} {{.Image}}' > "$upgrade_backup_dir/previous-containers.txt")
fi

# Refresh the repo. `git reset --hard` discards any local drift; PROD
# treats the repo as a read-only artifact.
cd "$REPO_DIR"
git fetch origin "$GIT_BRANCH"
git checkout "$GIT_BRANCH"
git reset --hard "origin/$GIT_BRANCH"

# Decrypt secrets to a fresh release.env. Atomic write: decrypt to a
# temp file in the same dir, fsync, rename — that way a partial decrypt
# never replaces the live env file.
TMP_ENV="$(mktemp -p "$(dirname "$RELEASE_ENV")" release.env.XXXXXX)"

# SOPS' dotenv renderer does not reliably quote whitespace or shell
# metacharacters (for example `PROD_ADMIN_NAME: "Heorhii Hudiiev"`). Render
# JSON and let jq produce shell-safe single-quoted assignments. The result is
# valid both for `source` below and Docker Compose's env-file parser.
SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" \
  sops -d --output-type json "$REPO_DIR/$SECRETS_PATH" \
  | jq -r \
    'to_entries[] | select(.value != null) | "\(.key)=\(.value | tostring | @sh)"' \
    > "$TMP_ENV"

# Sanity check before we go live: required keys must be present.
required_keys=(
  GMED_DATABASE_URL
  GMED_JWT_SECRET
  GMED_MESSAGE_ENCRYPTION_KEYS
  GMED_MESSAGE_ENCRYPTION_KEY_ACTIVE
  GMED_AUDIT_IP_SALT
  GMED_LEAD_INTAKE_TOKEN
  GMED_CORS_ORIGIN
  CADDY_HOSTNAME
  ACME_EMAIL
  POSTGRES_USER
  POSTGRES_PASSWORD
  GMED_BACKEND_IMAGE
  GMED_FRONTEND_IMAGE
  GMED_PARSER_IMAGE
  POSTGRES_METRICS_USER
  POSTGRES_METRICS_PASSWORD
  LOKI_URL
)
for key in "${required_keys[@]}"; do
  if ! grep -q "^${key}=" "$TMP_ENV"; then
    echo "ERROR: secrets.sops.yaml is missing required key: $key" >&2
    exit 1
  fi
done

install -m 600 "$TMP_ENV" "$RELEASE_ENV"

# Source the decrypted env into this shell so later steps (Tailscale
# auth, cosign verify) can read the values. `set -a` exports every
# subsequent assignment.
set -a
# shellcheck disable=SC1090
. "$RELEASE_ENV"
set +a

# Image digests are public release metadata, not secrets. Keep them in a
# separately reviewable Git-tracked file so promoting a signed release never
# requires distributing the production age private key.
#
# The file is read as DATA, never executed: only comments, blank lines and
# exactly one `KEY=value` line for each of the four image variables are
# accepted, and the value must be the expected GHCR repository pinned by a
# sha256 digest. Anything else (another variable, a command, a duplicate, a
# missing image) stops the deploy before a single image is verified or pulled.
load_image_pins() {
  local file="$1" line key ref repository count=0
  local -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    ref="${line#*=}"
    case "$key" in
      GMED_BACKEND_IMAGE) repository=gmed-crm-server ;;
      GMED_FRONTEND_IMAGE) repository=gmed-crm-frontend ;;
      GMED_PARSER_IMAGE) repository=gmed-crm-clinical-document-parser ;;
      GMED_INVOICE_PARSER_IMAGE) repository=gmed-crm-invoice-parser ;;
      *)
        echo "ERROR: $file: only the four GMED_*_IMAGE pins are allowed; unexpected line." >&2
        return 1
        ;;
    esac
    if [[ "$line" != "$key=$ref" || -n "${seen[$key]:-}" ||
          ! "$ref" =~ ^ghcr\.io/oleksandrmelnychenko/${repository}@sha256:[0-9a-f]{64}$ ]]; then
      echo "ERROR: $file: invalid or duplicate image pin for $key." >&2
      return 1
    fi
    seen[$key]="$ref"
    count=$((count + 1))
  done < "$file"
  if [[ "$count" -ne 4 ]]; then
    echo "ERROR: $file must pin all four images (backend, frontend, parser, invoice parser)." >&2
    return 1
  fi
  # Exported so Docker Compose uses these refs instead of any older value
  # that is still present in release.env.
  export GMED_BACKEND_IMAGE="${seen[GMED_BACKEND_IMAGE]}"
  export GMED_FRONTEND_IMAGE="${seen[GMED_FRONTEND_IMAGE]}"
  export GMED_PARSER_IMAGE="${seen[GMED_PARSER_IMAGE]}"
  export GMED_INVOICE_PARSER_IMAGE="${seen[GMED_INVOICE_PARSER_IMAGE]}"
}
load_image_pins "$REPO_DIR/$IMAGE_PINS_PATH"

# An ordinary release upgrade must never become a first-install data reset,
# even if the host's bootstrap marker is missing or its old SOPS flags remain.
if [[ "$UPGRADE_ONLY" == "true" ]]; then
  PROD_EMPTY_DATABASE_ON_FIRST_DEPLOY=false
  PROD_EMPTY_DATABASE_FORCE=false
  export PROD_EMPTY_DATABASE_ON_FIRST_DEPLOY PROD_EMPTY_DATABASE_FORCE
fi

# Keep the internal OCR credential on this host when it is not supplied in SOPS.
# The generated value is reused across releases and never enters frontend builds.
if [[ -z "${GMED_INVOICE_PARSER_API_KEY:-}" ]]; then
  invoice_parser_key_file=/etc/gmed/invoice-parser.key
  if [[ ! -s "$invoice_parser_key_file" ]]; then
    (umask 077; openssl rand -hex 32 > "$invoice_parser_key_file")
  fi
  chmod 600 "$invoice_parser_key_file"
  GMED_INVOICE_PARSER_API_KEY="$(cat "$invoice_parser_key_file")"
  if [[ ! "$GMED_INVOICE_PARSER_API_KEY" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: invalid stored internal invoice parser key." >&2
    exit 1
  fi
  export GMED_INVOICE_PARSER_API_KEY
  printf '\nGMED_INVOICE_PARSER_API_KEY=%s\n' "$GMED_INVOICE_PARSER_API_KEY" >> "$RELEASE_ENV"
fi

if [[ "${PROD_EMPTY_DATABASE_ON_FIRST_DEPLOY:-false}" == "true" ]]; then
  if [[ -z "${PROD_ADMIN_EMAIL:-}" || -z "${PROD_ADMIN_NAME:-}" || -z "${PROD_ADMIN_PASSWORD:-}" ]]; then
    echo "ERROR: PROD_EMPTY_DATABASE_ON_FIRST_DEPLOY=true requires PROD_ADMIN_EMAIL, PROD_ADMIN_NAME, and PROD_ADMIN_PASSWORD in secrets.sops.yaml" >&2
    exit 1
  fi
fi

# Ensure backup tooling is present. rclone and age are tiny; apt-get
# install is a fast no-op when already installed.
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  age ca-certificates unzip >/dev/null

# Ubuntu 24.04 currently ships an old rclone. Install a checksum-verified,
# pinned upstream binary so the S3 backend's `versioning` command is always
# available and backup behavior does not depend on the host apt snapshot.
if [[ ! -x /usr/local/bin/rclone ]] || ! /usr/local/bin/rclone version 2>/dev/null | grep -q "${RCLONE_VERSION}"; then
  RCLONE_ARCH="$(dpkg --print-architecture)" # amd64 | arm64
  RCLONE_ARCHIVE="rclone-${RCLONE_VERSION}-linux-${RCLONE_ARCH}.zip"
  (
    RCLONE_TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$RCLONE_TMP_DIR"' EXIT
    cd "$RCLONE_TMP_DIR"
    curl -fsSLO "https://downloads.rclone.org/${RCLONE_VERSION}/${RCLONE_ARCHIVE}"
    curl -fsSLO "https://downloads.rclone.org/${RCLONE_VERSION}/SHA256SUMS"
    grep " ${RCLONE_ARCHIVE}$" SHA256SUMS > rclone.checksum
    sha256sum -c rclone.checksum
    unzip -q "$RCLONE_ARCHIVE"
    install -o root -g root -m 755 \
      "${RCLONE_ARCHIVE%.zip}/rclone" /usr/local/bin/rclone
  )
fi

# Backups are encrypted client-side, and bucket versioning protects against
# accidental overwrite/delete. Fail the deploy if the configured backup
# bucket cannot be put into the required state.
if [[ -n "${BACKUP_S3_ENDPOINT:-}" && -n "${BACKUP_S3_BUCKET:-}" && \
      -n "${BACKUP_S3_ACCESS_KEY:-}" && -n "${BACKUP_S3_SECRET_KEY:-}" ]]; then
  export RCLONE_CONFIG_GMEDBACKUP_TYPE=s3
  export RCLONE_CONFIG_GMEDBACKUP_PROVIDER=Other
  export RCLONE_CONFIG_GMEDBACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
  export RCLONE_CONFIG_GMEDBACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
  export RCLONE_CONFIG_GMEDBACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
  export RCLONE_CONFIG_GMEDBACKUP_REGION="${BACKUP_S3_REGION:-auto}"

  VERSIONING_STATUS="$(rclone backend versioning \
    "gmedbackup:${BACKUP_S3_BUCKET}" Enabled)"
  if ! grep -q 'Enabled' <<<"$VERSIONING_STATUS"; then
    echo "ERROR: failed to confirm versioning on backup bucket ${BACKUP_S3_BUCKET}." >&2
    exit 1
  fi
  echo "Backup bucket versioning: Enabled"
fi

# Install cosign from upstream releases (Ubuntu apt does not ship it).
# The binary decides whether an image may run, so it is pinned by version
# AND by the sha256 from the release's cosign_checksums.txt (same rule as
# rclone above). The binary already on the host is checked against the same
# checksum on every deploy; a different file is replaced. The download is
# verified in a temporary directory and installed only after it matches.
COSIGN_ARCH="$(dpkg --print-architecture)"   # arm64 | amd64
case "$COSIGN_ARCH" in
  amd64) cosign_sha256="$cosign_sha256_amd64" ;;
  arm64) cosign_sha256="$cosign_sha256_arm64" ;;
  *)
    echo "ERROR: no pinned cosign checksum for architecture $COSIGN_ARCH." >&2
    exit 1
    ;;
esac
if [[ ! -x /usr/local/bin/cosign ]] ||
   [[ "$(sha256sum /usr/local/bin/cosign | cut -d' ' -f1)" != "$cosign_sha256" ]]; then
  (
    COSIGN_TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$COSIGN_TMP_DIR"' EXIT
    cd "$COSIGN_TMP_DIR"
    curl -fsSL \
      "https://github.com/sigstore/cosign/releases/download/${cosign_version}/cosign-linux-${COSIGN_ARCH}" \
      -o cosign
    printf '%s  cosign\n' "$cosign_sha256" | sha256sum -c -
    install -o root -g root -m 755 cosign /usr/local/bin/cosign
  )
fi

# Cosign keyless verification. Each image ref MUST be digest-pinned
# (`@sha256:...`). Floating tags would race the verify/pull window —
# we'd verify one digest and `docker pull` could resolve a different
# one if the tag rotated between calls.
for image_var in GMED_BACKEND_IMAGE GMED_FRONTEND_IMAGE GMED_PARSER_IMAGE GMED_INVOICE_PARSER_IMAGE; do
  ref="${!image_var:-}"
  case "$image_var" in
    GMED_BACKEND_IMAGE)
      expected_repository="ghcr.io/oleksandrmelnychenko/gmed-crm-server"
      ;;
    GMED_FRONTEND_IMAGE)
      expected_repository="ghcr.io/oleksandrmelnychenko/gmed-crm-frontend"
      ;;
    GMED_PARSER_IMAGE)
      expected_repository="ghcr.io/oleksandrmelnychenko/gmed-crm-clinical-document-parser"
      ;;
    GMED_INVOICE_PARSER_IMAGE)
      expected_repository="ghcr.io/oleksandrmelnychenko/gmed-crm-invoice-parser"
      ;;
  esac
  expected_prefix="${expected_repository}@sha256:"
  digest="${ref#"$expected_prefix"}"
  if [[ "$ref" != "${expected_prefix}${digest}" || ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: $image_var must pin the expected GHCR repository by sha256 digest. Got: $ref" >&2
    echo "Update $IMAGE_PINS_PATH from the successful release workflow summary." >&2
    exit 1
  fi
  echo "Verifying cosign signature on $ref"
  /usr/local/bin/cosign verify \
    --certificate-identity-regexp "$cosign_cert_identity_regexp" \
    --certificate-oidc-issuer "$cosign_oidc_issuer" \
    "$ref" >/dev/null
done

# Tailscale: bring up the daemon if a key is present in the release.env
# and the daemon is not already authenticated. Idempotent — `tailscale
# up` on an already-authenticated daemon with matching args is a fast
# no-op. We deliberately do NOT auto-disable Tailscale if the key is
# absent (might be a transient sops edit).
if [[ -n "${TAILSCALE_AUTH_KEY:-}" ]] && command -v tailscale >/dev/null 2>&1; then
  if ! tailscale status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
    echo "Bringing up Tailscale"
    hostname_args=()
    if [[ -n "${TAILSCALE_HOSTNAME:-}" ]]; then
      hostname_args=("--hostname=${TAILSCALE_HOSTNAME}")
    fi
    tailscale up \
      --authkey="$TAILSCALE_AUTH_KEY" \
      "${hostname_args[@]}" \
      --accept-routes=false \
      --accept-dns=false \
      --ssh=false
    echo "Tailscale: $(tailscale ip -4 2>/dev/null || echo 'pending')"
  fi
fi

# Install / refresh the backup cron entry. crond rejects files in
# /etc/cron.d that are group- or world-writable, so 644 is mandatory.
if [[ -r "$REPO_DIR/infra/cron/gmed-backup.cron" ]]; then
  install -o root -g root -m 644 \
    "$REPO_DIR/infra/cron/gmed-backup.cron" \
    /etc/cron.d/gmed-backup
  # Touch the log file so the very first cron run does not need to
  # create it with cron's default umask.
  touch /var/log/gmed-backup.log
  chmod 640 /var/log/gmed-backup.log
fi

# Install / refresh the external application health ping if configured.
# This is intentionally separate from Prometheus: Healthchecks.io is the
# outside watcher for "host or monitoring stack is gone".
if [[ -n "${HEALTHCHECKS_PING_URL:-}" ]]; then
  cat > /etc/cron.d/gmed-app-healthcheck <<EOF
# Auto-installed by deploy-prod.sh. Pings Healthchecks.io only after
# the public app health endpoint responds successfully.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root curl -fsS --max-time 10 "https://${CADDY_HOSTNAME}/health" >/dev/null 2>&1 && curl -fsS --retry 3 --max-time 10 "$HEALTHCHECKS_PING_URL" >/dev/null 2>&1
EOF
  chmod 600 /etc/cron.d/gmed-app-healthcheck
else
  rm -f /etc/cron.d/gmed-app-healthcheck
fi

# GMED_METRICS_BIND_ADDR (optional, secrets bundle) binds the metrics and
# monitoring ports to one address, normally this host's Tailscale IPv4
# address. A wrong or not yet assigned address would stop the containers that
# publish on it from starting, so it is checked before Compose runs.
if [[ -n "${GMED_METRICS_BIND_ADDR:-}" ]]; then
  if [[ ! "$GMED_METRICS_BIND_ADDR" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "ERROR: GMED_METRICS_BIND_ADDR must be an IPv4 address. Got: $GMED_METRICS_BIND_ADDR" >&2
    exit 1
  fi
  if [[ "$GMED_METRICS_BIND_ADDR" != "0.0.0.0" ]] &&
     ! ip -4 -o addr show | grep -qF " ${GMED_METRICS_BIND_ADDR}/"; then
    echo "ERROR: GMED_METRICS_BIND_ADDR=$GMED_METRICS_BIND_ADDR is not an address of this host (is Tailscale up?)." >&2
    exit 1
  fi
  echo "Metrics and monitoring ports bind to $GMED_METRICS_BIND_ADDR"
fi

compose_cmd=(
  docker compose
  --env-file "$RELEASE_ENV"
  -f docker-compose.yml
  -f docker-compose.release.yml
  -f docker-compose.hetzner.yml
  -f docker-compose.prod-hetzner.yml
  -f docker-compose.ghcr.yml
)
# Fine-tuned MT packages: only while the host folder exists (see the file).
if [[ -d /home/gmed/mt-models-ft ]]; then
  compose_cmd+=(-f docker-compose.prod-mt-ft.yml)
  echo "Fine-tuned MT models enabled from /home/gmed/mt-models-ft"
fi

prepare_upload_volume() {
  "${compose_cmd[@]}" run --rm --no-deps \
    --user 0:0 \
    --entrypoint /usr/local/bin/gmed-prepare-uploads \
    backend
}

wait_for_compose_service_healthy() {
  local service="$1"
  local cid=""
  local status=""

  for attempt in {1..120}; do
    cid="$("${compose_cmd[@]}" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        return 0
      fi
    fi

    if [[ "$attempt" -eq 120 ]]; then
      echo "ERROR: compose service '$service' did not become healthy after 120 seconds (last status: ${status:-unknown})." >&2
      "${compose_cmd[@]}" logs --tail=100 "$service" || true
      exit 1
    fi

    sleep 1
  done
}

compose_up_or_diagnose() {
  local compose_rc=0

  set +e
  "${compose_cmd[@]}" up -d --remove-orphans
  compose_rc=$?
  set -e

  if [[ "$compose_rc" -eq 0 ]]; then
    return 0
  fi

  echo "ERROR: docker compose failed to start the production stack." >&2
  "${compose_cmd[@]}" ps --all || true
  # Postgres is the root dependency for backend, parser and exporters.
  # Its logs do not contain the configured password and are the most
  # useful first diagnostic when Compose reports a dependency failure.
  "${compose_cmd[@]}" logs --no-color --tail=150 postgres || true
  return "$compose_rc"
}

run_migrations_without_public_listener() {
  local migration_cid=""
  local status=""

  "${compose_cmd[@]}" up -d postgres
  wait_for_compose_service_healthy postgres

  # `compose run` does not publish the backend service ports. The temporary
  # container therefore runs embedded migrations and reaches health without
  # exposing the application before the production sanitizer has completed.
  migration_cid="$("${compose_cmd[@]}" run -d --no-deps backend)"
  for attempt in {1..120}; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$migration_cid" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      docker rm -f "$migration_cid" >/dev/null
      return 0
    fi
    if [[ "$status" == "exited" || "$status" == "dead" ]]; then
      echo "ERROR: temporary migration backend exited before becoming healthy." >&2
      docker logs --tail=100 "$migration_cid" || true
      docker rm -f "$migration_cid" >/dev/null 2>&1 || true
      return 1
    fi
    if [[ "$attempt" -eq 120 ]]; then
      echo "ERROR: temporary migration backend did not become healthy." >&2
      docker logs --tail=100 "$migration_cid" || true
      docker rm -f "$migration_cid" >/dev/null 2>&1 || true
      return 1
    fi
    sleep 1
  done
}

verify_sanitized_production_database() {
  local counts=""
  local users admins patients leads cases orders invoices documents appointments tasks

  counts="$(PGPASSWORD="$POSTGRES_PASSWORD" docker exec -i -e PGPASSWORD gmed-postgres \
    psql \
      --quiet \
      --tuples-only \
      --no-align \
      --field-separator='|' \
      -v ON_ERROR_STOP=1 \
      -v admin_email="$PROD_ADMIN_EMAIL" \
      -U "$POSTGRES_USER" \
      -d "${POSTGRES_DB:-gmed}" <<'SQL'
SELECT
  (SELECT count(*) FROM users),
  (SELECT count(*) FROM users
     WHERE lower(email) = lower(:'admin_email')
       AND role = 'ceo'
       AND is_active = true),
  (SELECT count(*) FROM patients),
  (SELECT count(*) FROM leads),
  (SELECT count(*) FROM cases),
  (SELECT count(*) FROM orders),
  (SELECT count(*) FROM invoices),
  (SELECT count(*) FROM documents),
  (SELECT count(*) FROM appointments),
  (SELECT count(*) FROM tasks);
SQL
)"

  IFS='|' read -r users admins patients leads cases orders invoices documents appointments tasks \
    <<<"$counts"

  if [[ "$users" != "1" || "$admins" != "1" || "$patients" != "0" || \
        "$leads" != "0" || "$cases" != "0" || "$orders" != "0" || \
        "$invoices" != "0" || "$documents" != "0" || \
        "$appointments" != "0" || "$tasks" != "0" ]]; then
    echo "ERROR: production DB empty-state verification failed: users=$users admins=$admins patients=$patients leads=$leads cases=$cases orders=$orders invoices=$invoices documents=$documents appointments=$appointments tasks=$tasks" >&2
    return 1
  fi

  echo "Production DB verified: users=1 active_ceo=1 patients=0 leads=0 cases=0 orders=0 invoices=0 documents=0 appointments=0 tasks=0"
}

if [[ "$UPGRADE_ONLY" == "true" ]]; then
  install -m 600 "$RELEASE_ENV" "$upgrade_backup_dir/release.env"
  # The container description includes its environment (database password).
  (umask 077; docker inspect gmed-postgres > "$upgrade_backup_dir/postgres-container.json")
  python3 "$REPO_DIR/scripts/preflight-prod-migrations.py" \
    --migrations "$REPO_DIR/migrations" --backup-dir "$upgrade_backup_dir"
  # Older release backups go only now, when this upgrade has its own complete
  # dump and a passed rehearsal.
  prune_release_backups "$upgrade_backup_name"
fi

sanitized_this_run=false
prepare_upload_volume
if [[ "${PROD_EMPTY_DATABASE_ON_FIRST_DEPLOY:-false}" == "true" ]]; then
  sanitizer_marker="${PROD_EMPTY_DATABASE_MARKER:-/etc/gmed/prod-db-sanitized}"
  if [[ ! -e "$sanitizer_marker" || "${PROD_EMPTY_DATABASE_FORCE:-false}" == "true" ]]; then
    # A forced rerun may happen while an older stack is live. Remove every
    # public/application listener before the internal migration container.
    "${compose_cmd[@]}" stop caddy frontend backend clinical-document-parser
    run_migrations_without_public_listener
    bash "$REPO_DIR/scripts/sanitize-prod-db.sh"
    sanitized_this_run=true
  else
    echo "Production DB sanitizer marker exists ($sanitizer_marker); data sanitizer skipped."
  fi
fi

# Bring (or keep) services up only after any first-deploy sanitization. No
# --build: production pulls cosign-verified images and never builds locally.
compose_up_or_diagnose
wait_for_compose_service_healthy backend
wait_for_compose_service_healthy invoice-parser
wait_for_compose_service_healthy machine-translation
wait_for_compose_service_healthy frontend

# The 2026-08-31 authentication correction must also take effect when PROD is
# still running the previously signed backend image. Apply the repository SQL
# directly after Postgres is available; the statements are idempotent. A later
# backend release will execute and record the same SQLx migration normally.
login_preservation_migrations=(
  "$REPO_DIR/migrations/20260831150000_preserve_existing_account_login.sql"
  "$REPO_DIR/migrations/20260831151000_grandfather_existing_account_password_age.sql"
)
for login_preservation_migration in "${login_preservation_migrations[@]}"; do
  if [[ -r "$login_preservation_migration" ]]; then
    echo "Applying $(basename "$login_preservation_migration")"
    PGPASSWORD="$POSTGRES_PASSWORD" docker exec -i -e PGPASSWORD gmed-postgres \
      psql \
        --quiet \
        --no-psqlrc \
        -v ON_ERROR_STOP=1 \
        -U "$POSTGRES_USER" \
        -d "${POSTGRES_DB:-gmed}" \
      < "$login_preservation_migration"
  fi
done

if [[ "$sanitized_this_run" == "true" ]]; then
  verify_sanitized_production_database
fi

if [[ -x "$REPO_DIR/scripts/ensure-prod-metrics-user.sh" ]]; then
  "$REPO_DIR/scripts/ensure-prod-metrics-user.sh"
  docker restart gmed-postgres-exporter >/dev/null 2>&1 || true
fi

# Capture a recoverable encrypted baseline immediately after the first
# production bootstrap. Daily backups continue through /etc/cron.d/gmed-backup.
bootstrap_backup_marker="${PROD_BOOTSTRAP_BACKUP_MARKER:-/etc/gmed/prod-bootstrap-backup}"
if [[ ! -e "$bootstrap_backup_marker" ]]; then
  bash "$REPO_DIR/scripts/backup-postgres.sh"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$bootstrap_backup_marker"
  chmod 600 "$bootstrap_backup_marker"
  echo "Production bootstrap backup completed."
else
  echo "Production bootstrap backup marker exists ($bootstrap_backup_marker); skipped."
fi

if [[ "$IMPORT_BOOTSTRAP_DIRECTORY" == "true" ]]; then
  bash "$REPO_DIR/scripts/import-prod-bootstrap-directory.sh" \
    /home/gmed/gmed-bootstrap-directory-v1.json
fi

# Prune dangling images so the host doesn't accumulate layers from
# older pinned digests. The volumes (pgdata, uploads, caddy_data) are
# explicitly excluded by `docker image prune` (it only touches images).
docker image prune -f --filter "until=24h"

date -u +%Y-%m-%dT%H:%M:%SZ > /etc/gmed/deploy.last
git rev-parse HEAD > /etc/gmed/deploy.revision
PGPASSWORD="$POSTGRES_PASSWORD" docker exec -e PGPASSWORD gmed-postgres \
  psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${POSTGRES_DB:-gmed}" \
  -c "SELECT 'Successful migrations: ' || count(*) FROM _sqlx_migrations WHERE success"
for service in backend frontend clinical-document-parser machine-translation invoice-parser; do
  cid="$("${compose_cmd[@]}" ps -q "$service")"
  docker inspect -f '{{.Name}} {{.Config.Image}} status={{.State.Status}} restarts={{.RestartCount}} {{if .State.Health}}health={{.State.Health.Status}}{{end}}' "$cid"
done
if [[ "$UPGRADE_ONLY" == "true" ]]; then
  seal_release_backups || echo "WARN: release backups were not encrypted."
fi
echo "Deploy complete."
