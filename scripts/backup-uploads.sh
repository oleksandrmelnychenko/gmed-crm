#!/usr/bin/env bash
# Daily encrypted off-host backup of the uploads volume (patient documents,
# chat attachments).
#
# The Postgres dump alone is not a usable backup: `documents` rows only point
# at files in this volume. Restoring the database without the files yields
# records whose PDFs are gone, so both backups run every night.
#
# Pipeline (mirrors backup-postgres.sh):
#   tar -C <volume mountpoint> -czf - .
#     │
#     ▼  age -e -R <recipients>        # encrypted at source, key never on host
#   rclone rcat gmedbackup:<bucket>/uploads/<stamp>.tar.gz.age
#
# Nothing is staged on disk: the archive streams straight into the upload.

set -euo pipefail

RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-gmed-crm_uploads}"
REMOTE_NAME="${REMOTE_NAME:-gmedbackup}"
PREFIX="${PREFIX:-uploads}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root (reads the Docker volume directly)." >&2
  exit 1
fi

finish() {
  local rc=$?
  trap - EXIT
  echo "[$(date -u +%FT%TZ)] backup-uploads finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

if [[ ! -r "$RELEASE_ENV" ]]; then
  echo "ERROR: $RELEASE_ENV missing or unreadable. Run deploy-prod.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$RELEASE_ENV"
set +a

required=(
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

MOUNTPOINT="$(docker volume inspect -f '{{ .Mountpoint }}' "$UPLOADS_VOLUME")"
if [[ -z "$MOUNTPOINT" || ! -d "$MOUNTPOINT" ]]; then
  echo "ERROR: uploads volume $UPLOADS_VOLUME has no readable mountpoint" >&2
  exit 1
fi

export RCLONE_CONFIG_GMEDBACKUP_TYPE=s3
export RCLONE_CONFIG_GMEDBACKUP_PROVIDER=Other
export RCLONE_CONFIG_GMEDBACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_GMEDBACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
export RCLONE_CONFIG_GMEDBACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
export RCLONE_CONFIG_GMEDBACKUP_REGION="${BACKUP_S3_REGION:-auto}"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
KEY="$PREFIX/gmed-prod-${STAMP}.tar.gz.age"
FILES="$(find "$MOUNTPOINT" -type f | wc -l)"

echo "[$(date -u +%FT%TZ)] backup start ($FILES files) → s3://$BACKUP_S3_BUCKET/$KEY"

# --numeric-owner: the volume stores numeric ownership the runtime image
# depends on (see Dockerfile.backend), so names must not be remapped on restore.
# A file written while tar reads it makes tar exit 1 ("file changed as we read
# it"); that upload is still complete, so only a real failure (rc>1) aborts.
set +e
tar -C "$MOUNTPOINT" --numeric-owner -czf - . \
  | age -e -R <(printf '%s\n' "$BACKUP_AGE_RECIPIENTS") \
  | rclone rcat \
      --s3-no-check-bucket \
      --retries 3 \
      "$REMOTE_NAME:$BACKUP_S3_BUCKET/$KEY"
statuses=("${PIPESTATUS[@]}")
set -e
if (( statuses[0] > 1 || statuses[1] != 0 || statuses[2] != 0 )); then
  echo "ERROR: pipeline failed (tar=${statuses[0]} age=${statuses[1]} rclone=${statuses[2]})" >&2
  exit 1
fi

echo "[$(date -u +%FT%TZ)] backup uploaded"

# Retention: old copies are removed once the newest one is safely uploaded, so
# the bucket never holds more personal data than the recovery window needs
# (Art. 5 Abs. 1 lit. e DSGVO). Default 35 days; the deletion is a plain
# object delete, a failure here does not fail the backup.
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-35}"
if rclone delete --min-age "${RETENTION_DAYS}d" "$REMOTE_NAME:$BACKUP_S3_BUCKET/$PREFIX/"; then
  echo "[$(date -u +%FT%TZ)] pruned copies older than ${RETENTION_DAYS} days"
else
  echo "WARN: pruning old backups failed (backup itself succeeded)"
fi

if [[ -n "${BACKUP_UPLOADS_HEALTHCHECKS_PING_URL:-}" ]]; then
  curl -fsS --retry 3 --max-time 10 "$BACKUP_UPLOADS_HEALTHCHECKS_PING_URL" >/dev/null \
    || echo "WARN: Healthchecks.io ping failed (backup itself succeeded)"
fi

echo "[$(date -u +%FT%TZ)] backup OK: $KEY"
