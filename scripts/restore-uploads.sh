#!/usr/bin/env bash
# Restore the uploads volume from Hetzner Object Storage.
#
# Runbook helper, the counterpart of restore-postgres.sh. Restore the database
# and the uploads from the SAME night, otherwise document rows and files drift.
#
# Preconditions: the backup age PRIVATE key at /etc/gmed/backup-age.key
# (root, mode 600) — see restore-postgres.sh for how to place and shred it.
#
#   sudo /opt/gmed/repo/scripts/restore-uploads.sh --list
#   sudo /opt/gmed/repo/scripts/restore-uploads.sh <key>                  # verify only
#   sudo /opt/gmed/repo/scripts/restore-uploads.sh <key> --yes-overwrite-uploads
#
# The restore only adds and overwrites files; it never deletes files that are
# newer than the backup. Stop the backend first so nothing writes meanwhile.

set -euo pipefail

RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
BACKUP_AGE_KEY="${BACKUP_AGE_KEY:-/etc/gmed/backup-age.key}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-gmed-crm_uploads}"
REMOTE_NAME="${REMOTE_NAME:-gmedbackup}"
LOG_FILE="${LOG_FILE:-/var/log/gmed-restore.log}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root (writes the Docker volume directly)." >&2
  exit 1
fi

install -d -m 755 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"
exec > >(TZ=UTC awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_FILE") 2>&1

finish() {
  local rc=$?
  trap - EXIT
  echo "restore-uploads finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

echo "restore-uploads started"

set -a
# shellcheck disable=SC1090
. "$RELEASE_ENV"
set +a

export RCLONE_CONFIG_GMEDBACKUP_TYPE=s3
export RCLONE_CONFIG_GMEDBACKUP_PROVIDER=Other
export RCLONE_CONFIG_GMEDBACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_GMEDBACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
export RCLONE_CONFIG_GMEDBACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
export RCLONE_CONFIG_GMEDBACKUP_REGION="${BACKUP_S3_REGION:-auto}"

if [[ "${1:-}" == "--list" ]]; then
  rclone lsf --format "tsp" "$REMOTE_NAME:$BACKUP_S3_BUCKET/uploads/" \
    | sort -k2 -t$'\t'
  exit 0
fi

BACKUP_KEY="${1:-}"
if [[ -z "$BACKUP_KEY" ]]; then
  echo "Usage: $0 <backup-key>      (e.g. uploads/gmed-prod-2026-05-13T024500Z.tar.gz.age)" >&2
  echo "       $0 --list" >&2
  exit 1
fi

if [[ ! -r "$BACKUP_AGE_KEY" ]]; then
  echo "ERROR: $BACKUP_AGE_KEY missing. See restore-postgres.sh for setup." >&2
  exit 1
fi

if [[ "${2:-}" != "--yes-overwrite-uploads" ]]; then
  # Verify-only: decrypt and walk the archive without writing anything.
  COUNT="$(rclone cat "$REMOTE_NAME:$BACKUP_S3_BUCKET/$BACKUP_KEY" \
    | age -d -i "$BACKUP_AGE_KEY" \
    | tar -tzf - | wc -l)"
  cat <<EOF

Archive is readable: $COUNT entries. Nothing was written.
To restore into the "$UPLOADS_VOLUME" volume, stop the backend and re-run:

  sudo $0 $BACKUP_KEY --yes-overwrite-uploads

EOF
  exit 0
fi

MOUNTPOINT="$(docker volume inspect -f '{{ .Mountpoint }}' "$UPLOADS_VOLUME")"
if [[ -z "$MOUNTPOINT" || ! -d "$MOUNTPOINT" ]]; then
  echo "ERROR: uploads volume $UPLOADS_VOLUME has no mountpoint" >&2
  exit 1
fi

echo "extracting into $MOUNTPOINT"
rclone cat "$REMOTE_NAME:$BACKUP_S3_BUCKET/$BACKUP_KEY" \
  | age -d -i "$BACKUP_AGE_KEY" \
  | tar -C "$MOUNTPOINT" --numeric-owner -xzpf -

echo "restore complete. Don't forget to:"
echo "  - restore the database from the same night (restore-postgres.sh)"
echo "  - shred /etc/gmed/backup-age.key"
