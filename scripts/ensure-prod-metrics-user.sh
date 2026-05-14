#!/usr/bin/env bash
# Idempotently creates / rotates the read-only postgres_exporter user.
#
# Run on the PROD host after /opt/gmed/release.env exists. deploy-prod.sh
# invokes this automatically after the compose stack is reconciled, so
# the old manual SQL step is only a fallback runbook action now.

set -euo pipefail

RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-gmed-postgres}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: ensure-prod-metrics-user.sh must be run as root (sudo)." >&2
  exit 1
fi

if [[ ! -r "$RELEASE_ENV" ]]; then
  echo "ERROR: $RELEASE_ENV missing or unreadable. Run deploy-prod.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$RELEASE_ENV"
set +a

required=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_METRICS_USER
  POSTGRES_METRICS_PASSWORD
)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "ERROR: required env var $key not set in $RELEASE_ENV" >&2
    exit 1
  fi
done

POSTGRES_DB="${POSTGRES_DB:-gmed}"

echo "Ensuring postgres metrics role '$POSTGRES_METRICS_USER' exists"

for attempt in {1..60}; do
  if docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "ERROR: Postgres did not become ready after 60 seconds." >&2
    exit 1
  fi
  sleep 1
done

docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
  psql \
    -v ON_ERROR_STOP=1 \
    -v metrics_user="$POSTGRES_METRICS_USER" \
    -v metrics_password="$POSTGRES_METRICS_PASSWORD" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'metrics_user', :'metrics_password')
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'metrics_user'
);
\gexec

ALTER ROLE :"metrics_user" WITH LOGIN PASSWORD :'metrics_password';
GRANT pg_monitor TO :"metrics_user";
SQL

echo "Postgres metrics role is ready."
