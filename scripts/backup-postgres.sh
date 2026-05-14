#!/usr/bin/env bash
# Daily encrypted off-host Postgres backup.
#
# Pipeline:
#   docker exec pg_dump -Fc -Z6           # native pg compression
#     │
#     ▼  binary custom-format dump on stdout
#   age -e -R <(printf '%s' "$BACKUP_AGE_RECIPIENTS")
#     │
#     ▼  multi-recipient encryption at source
#   rclone rcat gmedbackup:<bucket>/postgres/<stamp>.pgdump.age
#     │
#     ▼  streaming upload to Hetzner Object Storage
#   curl $BACKUP_HEALTHCHECKS_PING_URL    # success ping (optional)
#
# Why multi-recipient: the backup age PRIVATE key never lives on this
# host. If we lose access to the only private key (forgotten 1Password
# password, broken hardware key), the backups are unreadable. age lets
# us encrypt to several public keys at once so any one of them can
# decrypt the file later. Store at least one recovery recipient offline
# (paper, separate hardware key).
#
# Why pipe through `rclone rcat`: streaming upload means the dump never
# lands on the host as plaintext. The only on-disk staging is whatever
# pg_dump and rclone buffer internally — short-lived, never written to a
# file.
#
# Why pg_dump runs in the container: avoids installing the Postgres
# client tooling on the host. The container always has a version that
# matches the server.

set -euo pipefail

RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-gmed-postgres}"
REMOTE_NAME="${REMOTE_NAME:-gmedbackup}"
PREFIX="${PREFIX:-postgres}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root (cron installs us that way)." >&2
  exit 1
fi

finish() {
  local rc=$?
  trap - EXIT
  echo "[$(date -u +%FT%TZ)] backup-postgres finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

if [[ ! -r "$RELEASE_ENV" ]]; then
  echo "ERROR: $RELEASE_ENV missing or unreadable. Run deploy-prod.sh first." >&2
  exit 1
fi

# Load sops-decrypted env. `set -a` exports every assignment until the
# matching `set +a`.
set -a
# shellcheck disable=SC1090
. "$RELEASE_ENV"
set +a

required=(
  POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD
  BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET
  BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
  BACKUP_AGE_RECIPIENTS
)
for v in "${required[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "ERROR: required env var $v not set in $RELEASE_ENV" >&2
    exit 1
  fi
done

# rclone remote configured purely via env — no rclone.conf on disk.
# The "Other" provider tells rclone not to assume AWS-specific quirks
# (e.g. STS, IAM roles).
export RCLONE_CONFIG_GMEDBACKUP_TYPE=s3
export RCLONE_CONFIG_GMEDBACKUP_PROVIDER=Other
export RCLONE_CONFIG_GMEDBACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_GMEDBACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
export RCLONE_CONFIG_GMEDBACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
export RCLONE_CONFIG_GMEDBACKUP_REGION="${BACKUP_S3_REGION:-auto}"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
KEY="$PREFIX/gmed-prod-${STAMP}.pgdump.age"

echo "[$(date -u +%FT%TZ)] backup start → s3://$BACKUP_S3_BUCKET/$KEY"

# `-T` not needed (no -i interactive flag); the pipe naturally gives a
# non-TTY stdin. `-Fc` is the custom format (pg_restore-friendly),
# `-Z 6` is zstd-level compression inside the dump.
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6 \
  | age -e -R <(printf '%s\n' "$BACKUP_AGE_RECIPIENTS") \
  | rclone rcat \
      --s3-no-check-bucket \
      --retries 3 \
      "$REMOTE_NAME:$BACKUP_S3_BUCKET/$KEY"

echo "[$(date -u +%FT%TZ)] backup uploaded"

# Healthchecks.io ping — best-effort, never fails the backup if the
# ping itself fails (a missed ping triggers an alert anyway).
if [[ -n "${BACKUP_HEALTHCHECKS_PING_URL:-}" ]]; then
  curl -fsS --retry 3 --max-time 10 "$BACKUP_HEALTHCHECKS_PING_URL" >/dev/null \
    || echo "WARN: Healthchecks.io ping failed (backup itself succeeded)"
fi

echo "[$(date -u +%FT%TZ)] backup OK: $KEY"
