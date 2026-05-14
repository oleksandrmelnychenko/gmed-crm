#!/usr/bin/env bash
# Restore a Postgres backup from Hetzner Object Storage.
#
# This is a runbook helper, not a routine operation. Restoring is
# DESTRUCTIVE: it drops and recreates the live database. Read the
# whole script before running.
#
# Preconditions (do these manually before invoking):
#
#   1. SCP the backup age PRIVATE key to the host as root, mode 600:
#        # from your laptop
#        scp /path/to/backup-age.key gmed@console.gmed-health.com:/tmp/k
#        # on the server
#        sudo install -o root -g root -m 600 /tmp/k /etc/gmed/backup-age.key
#        shred -u /tmp/k
#
#   2. Identify the backup to restore. List available backups:
#        sudo /opt/gmed/repo/scripts/restore-postgres.sh --list
#
# Restore syntax:
#   sudo /opt/gmed/repo/scripts/restore-postgres.sh <key>
#
# Cleanup AFTER restore: shred the key so a host compromise can't read
# the whole backup archive.
#   sudo shred -u /etc/gmed/backup-age.key

set -euo pipefail

RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
BACKUP_AGE_KEY="${BACKUP_AGE_KEY:-/etc/gmed/backup-age.key}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-gmed-postgres}"
REMOTE_NAME="${REMOTE_NAME:-gmedbackup}"
LOG_FILE="${LOG_FILE:-/var/log/gmed-restore.log}"
TMP=""

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root (uses Docker, /etc/gmed/, and /var/tmp)." >&2
  exit 1
fi

install -d -m 755 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"
exec > >(TZ=UTC awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_FILE") 2>&1

finish() {
  local rc=$?
  trap - EXIT
  if [[ -n "${TMP:-}" ]]; then
    shred -u "$TMP" 2>/dev/null || rm -f "$TMP" || true
  fi
  echo "restore-postgres finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

echo "restore-postgres started"

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
  rclone lsf --format "tsp" "$REMOTE_NAME:$BACKUP_S3_BUCKET/postgres/" \
    | sort -k2 -t$'\t'
  exit 0
fi

BACKUP_KEY="${1:-}"
if [[ -z "$BACKUP_KEY" ]]; then
  echo "Usage: $0 <backup-key>      (e.g. postgres/gmed-prod-2026-05-13T023000Z.pgdump.age)" >&2
  echo "       $0 --list" >&2
  exit 1
fi

if [[ ! -r "$BACKUP_AGE_KEY" ]]; then
  echo "ERROR: $BACKUP_AGE_KEY missing. See the script header for setup." >&2
  exit 1
fi

# Decrypt to a tmp file. /var/tmp survives reboots but a `trap rm` makes
# sure we don't leave plaintext around on a successful exit.
TMP="$(mktemp -p /var/tmp gmed-restore.XXXXXX.pgdump)"
chmod 600 "$TMP"

echo "[$(date -u +%FT%TZ)] downloading + decrypting → $TMP"
rclone cat "$REMOTE_NAME:$BACKUP_S3_BUCKET/$BACKUP_KEY" \
  | age -d -i "$BACKUP_AGE_KEY" \
  > "$TMP"

SIZE="$(du -h "$TMP" | cut -f1)"
echo "[$(date -u +%FT%TZ)] decrypted ($SIZE)"

# Confirm: this is destructive. The script halts here unless the
# operator passes `--yes-destroy-current-db` as the second arg.
if [[ "${2:-}" != "--yes-destroy-current-db" ]]; then
  cat <<EOF

The next step DROPS the current "$POSTGRES_DB" database and replaces
it with the backup. To proceed, re-run with the explicit confirmation:

  sudo $0 $BACKUP_KEY --yes-destroy-current-db

Or, to inspect the dump before restoring (recommended for high-stakes
restores), use the tmp file directly:

  docker cp $TMP $POSTGRES_CONTAINER:/tmp/restore.pgdump
  docker exec -it $POSTGRES_CONTAINER pg_restore -l /tmp/restore.pgdump | head -40

EOF
  exit 0
fi

echo "[$(date -u +%FT%TZ)] dropping and recreating database '$POSTGRES_DB'"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
  dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"

echo "[$(date -u +%FT%TZ)] pg_restore in progress (this may take a while)"
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --no-owner --no-privileges --exit-on-error \
  < "$TMP"

echo "[$(date -u +%FT%TZ)] restore complete. Don't forget to:"
echo "  - shred /etc/gmed/backup-age.key (it should not live on a running server)"
echo "  - verify app health: curl https://\$CADDY_HOSTNAME/health"
