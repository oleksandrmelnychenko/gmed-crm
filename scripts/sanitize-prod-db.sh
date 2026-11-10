#!/usr/bin/env bash
# One-time PROD data sanitizer.
#
# Intended for the first production deploy only: keep schema, migrations,
# reference dictionaries and system settings, but remove all business/demo
# rows and leave exactly one admin user.

set -euo pipefail

RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-gmed-postgres}"
MARKER_FILE="${PROD_EMPTY_DATABASE_MARKER:-/etc/gmed/prod-db-sanitized}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: sanitize-prod-db.sh must be run as root (sudo)." >&2
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

if [[ "${PROD_EMPTY_DATABASE_ON_FIRST_DEPLOY:-false}" != "true" ]]; then
  echo "PROD_EMPTY_DATABASE_ON_FIRST_DEPLOY is not true; skipping data sanitizer."
  exit 0
fi

if [[ -e "$MARKER_FILE" && "${PROD_EMPTY_DATABASE_FORCE:-false}" != "true" ]]; then
  echo "Production DB sanitizer already ran ($MARKER_FILE); skipping."
  exit 0
fi

required=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  PROD_ADMIN_PASSWORD
)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "ERROR: required env var $key not set in $RELEASE_ENV" >&2
    exit 1
  fi
done

POSTGRES_DB="${POSTGRES_DB:-gmed}"
PROD_ADMIN_EMAIL="${PROD_ADMIN_EMAIL:-h.hudiiev@gmed-health.com}"
PROD_ADMIN_NAME="${PROD_ADMIN_NAME:-Heorhii Hudiiev}"

# Secrets reach the container through its environment, passed by NAME
# (`docker exec -e PGPASSWORD`), never as `-e NAME=value` or `psql -v`:
# command-line arguments are readable by every user on the host in /proc.
export PGPASSWORD="$POSTGRES_PASSWORD"
export GMED_SANITIZE_ADMIN_PASSWORD="$PROD_ADMIN_PASSWORD"

# A database counts as new only while nobody has signed in and its first
# migration is younger than this many hours (the first deploy applies all
# migrations minutes before this script runs).
SANITIZE_NEW_DATABASE_MAX_HOURS=24
SANITIZE_BACKUP_ROOT="${PROD_SANITIZE_BACKUP_ROOT:-/var/backups/gmed/sanitize}"

echo "Waiting for Postgres before production data sanitizer"
for attempt in {1..60}; do
  if docker exec -e PGPASSWORD "$POSTGRES_CONTAINER" \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "ERROR: Postgres did not become ready after 60 seconds." >&2
    exit 1
  fi
  sleep 1
done

# Read the state of the database BEFORE anything is removed. This query must
# succeed: an error (no connection, wrong password, missing table, unexpected
# output) stops the script. It used to be read as "not sanitized yet", which
# let a broken query lead straight to the TRUNCATE below.
if ! db_state="$(
  docker exec -i -e PGPASSWORD "$POSTGRES_CONTAINER" \
    psql \
      --no-psqlrc \
      --quiet \
      --tuples-only \
      --no-align \
      --field-separator='|' \
      -v ON_ERROR_STOP=1 \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" <<'SQL'
SELECT
  COALESCE((
    SELECT value #>> '{}'
    FROM system_settings
    WHERE key = 'prod_db_sanitized_at'
  ), ''),
  (SELECT count(*) FROM patients)
    + (SELECT count(*) FROM leads)
    + (SELECT count(*) FROM cases)
    + (SELECT count(*) FROM orders)
    + (SELECT count(*) FROM invoices)
    + (SELECT count(*) FROM documents),
  (SELECT count(*) FROM token_families),
  COALESCE((
    SELECT floor(extract(epoch FROM now() - min(installed_on)) / 3600)::bigint
    FROM _sqlx_migrations
  ), 999999);
SQL
)"; then
  echo "ERROR: cannot read the sanitizer marker and row counts from the database; nothing was changed." >&2
  exit 1
fi
db_state="${db_state//$'\r'/}"
db_state="${db_state//$'\n'/}"
IFS='|' read -r db_marker core_rows sign_ins db_age_hours <<<"$db_state"
if [[ ! "${core_rows:-}" =~ ^[0-9]+$ || ! "${sign_ins:-}" =~ ^[0-9]+$ || ! "${db_age_hours:-}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: unexpected answer from the database state query; nothing was changed." >&2
  exit 1
fi

if [[ -n "$db_marker" && "${PROD_EMPTY_DATABASE_FORCE:-false}" != "true" ]]; then
  echo "Production DB sanitizer already recorded in DB ($db_marker); writing host marker and skipping."
  install -d -o root -g root -m 755 "$(dirname "$MARKER_FILE")"
  printf '%s\n' "$db_marker" > "$MARKER_FILE"
  chmod 600 "$MARKER_FILE"
  exit 0
fi

# A database that is in use is never emptied by accident. The migrations seed
# demo rows, so "has rows" alone cannot be the test on a first deploy; a
# database is treated as in use when somebody has signed in, or when it holds
# patient/lead/case/order/invoice/document rows and was created more than
# SANITIZE_NEW_DATABASE_MAX_HOURS ago. Emptying such a database needs the
# confirmation below in the environment of the command, with today's UTC date,
# so a value left in a file or in the shell history stops working tomorrow.
wipe_confirmation="wipe-${POSTGRES_DB}-$(date -u +%Y-%m-%d)"
if (( sign_ins > 0 )) || (( core_rows > 0 && db_age_hours >= SANITIZE_NEW_DATABASE_MAX_HOURS )); then
  if [[ "${PROD_SANITIZE_CONFIRM_DELETE_ALL_BUSINESS_DATA:-}" != "$wipe_confirmation" ]]; then
    echo "ERROR: database '$POSTGRES_DB' is in use (sign-ins=$sign_ins, patient/lead/case/order/invoice/document rows=$core_rows, first migration ${db_age_hours}h ago); the sanitizer refuses to empty it." >&2
    echo "An existing installation is upgraded with: deploy-prod.sh --upgrade-only" >&2
    echo "To delete ALL business data on purpose, rerun with PROD_SANITIZE_CONFIRM_DELETE_ALL_BUSINESS_DATA=$wipe_confirmation" >&2
    exit 1
  fi
  echo "WARNING: confirmed deletion of all business data in a database that is in use (sign-ins=$sign_ins, rows=$core_rows)."
fi

# Keep a copy of what is about to be removed. The dump stays on this host in a
# root-only directory; it is encrypted for the backup recipients when they are
# configured (restore: age -d with the backup private key, then pg_restore).
# A failed dump stops the script before any row is touched.
sanitize_backup_dir="$SANITIZE_BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 700 "$SANITIZE_BACKUP_ROOT" "$sanitize_backup_dir"
(
  umask 077
  if [[ -n "${BACKUP_AGE_RECIPIENTS:-}" ]] && command -v age >/dev/null 2>&1; then
    sanitize_backup_file="$sanitize_backup_dir/database-before-sanitize.pgdump.age"
    docker exec -e PGPASSWORD "$POSTGRES_CONTAINER" \
      pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
      | age -e -R <(printf '%s\n' "$BACKUP_AGE_RECIPIENTS") -o "$sanitize_backup_file"
  else
    sanitize_backup_file="$sanitize_backup_dir/database-before-sanitize.pgdump"
    docker exec -e PGPASSWORD "$POSTGRES_CONTAINER" \
      pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$sanitize_backup_file"
  fi
  if [[ ! -s "$sanitize_backup_file" ]]; then
    echo "ERROR: the backup before sanitizing is empty: $sanitize_backup_file" >&2
    exit 1
  fi
  echo "Backup before sanitizing: $sanitize_backup_file"
)

echo "Sanitizing production database data; keeping admin '$PROD_ADMIN_EMAIL'"
# The admin password is read inside psql from the container environment
# (\getenv, psql 15+; the postgres:16 image ships psql 16). With an older psql or a
# missing variable the statements below fail and nothing is committed.
docker exec -i -e PGPASSWORD -e GMED_SANITIZE_ADMIN_PASSWORD "$POSTGRES_CONTAINER" \
  psql \
    --no-psqlrc \
    -v ON_ERROR_STOP=1 \
    -v admin_email="$PROD_ADMIN_EMAIL" \
    -v admin_name="$PROD_ADMIN_NAME" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" <<'SQL'
\getenv admin_password GMED_SANITIZE_ADMIN_PASSWORD
\if :{?admin_password}
\else
  \echo 'ERROR: the admin password did not reach psql'
  \quit
\endif
BEGIN;

SELECT set_config('gmed.sanitize.admin_email', :'admin_email', true);

INSERT INTO users (
  email,
  password_hash,
  name,
  role,
  is_active,
  mfa_required,
  mfa_backup_codes,
  failed_login_attempts,
  locked_until,
  password_history,
  password_changed_at,
  password_reset_required,
  updated_at
)
VALUES (
  :'admin_email',
  crypt(:'admin_password', gen_salt('bf')),
  :'admin_name',
  'ceo',
  true,
  false,
  NULL,
  0,
  NULL,
  '[]'::jsonb,
  now(),
  false,
  now()
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = 'ceo',
  is_active = true,
  mfa_required = false,
  mfa_backup_codes = NULL,
  failed_login_attempts = 0,
  locked_until = NULL,
  password_history = '[]'::jsonb,
  password_changed_at = now(),
  password_reset_required = false,
  updated_at = now();

DO $$
DECLARE
  table_list text;
  table_count integer;
BEGIN
  SELECT
    string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename),
    count(*)
  INTO table_list, table_count
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> ALL (ARRAY[
      '_sqlx_migrations',
      'schema_migrations',
      'users',
      'system_settings',
      'field_access_policies',
      'ref_countries',
      'ref_languages',
      'ref_document_categories',
      'tax_profiles',
      'medical_specializations',
      'provider_staff_roles',
      'provider_taxonomy_nodes',
      'drug_substances',
      'drug_products',
      'drug_product_substances',
      'drug_equivalents'
    ]);

  IF table_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY';
  END IF;

  RAISE NOTICE 'Sanitized % data tables', COALESCE(table_count, 0);
END $$;

DO $$
DECLARE
  fk record;
  admin_id uuid;
BEGIN
  SELECT id INTO STRICT admin_id
  FROM users
  WHERE email = current_setting('gmed.sanitize.admin_email');

  FOR fk IN
    SELECT
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
     AND tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
    JOIN information_schema.columns cols
      ON cols.table_schema = kcu.table_schema
     AND cols.table_name = kcu.table_name
     AND cols.column_name = kcu.column_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'users'
      AND kcu.table_schema = 'public'
      AND cols.is_nullable = 'YES'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = NULL WHERE %I IS NOT NULL AND %I <> $1',
      fk.table_schema,
      fk.table_name,
      fk.column_name,
      fk.column_name,
      fk.column_name
    )
    USING admin_id;
  END LOOP;
END $$;

DELETE FROM users
WHERE email <> :'admin_email';

UPDATE users
SET
  role = 'ceo',
  is_active = true,
  mfa_required = false,
  mfa_backup_codes = NULL,
  failed_login_attempts = 0,
  locked_until = NULL,
  password_history = '[]'::jsonb,
  password_changed_at = now(),
  password_reset_required = false,
  updated_at = now()
WHERE email = :'admin_email';

DO $$
DECLARE
  total_users integer;
  expected_admins integer;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (
      WHERE email = current_setting('gmed.sanitize.admin_email')
        AND role = 'ceo'
        AND is_active = true
        AND password_reset_required = false
    )
  INTO total_users, expected_admins
  FROM users;

  IF total_users <> 1 OR expected_admins <> 1 THEN
    RAISE EXCEPTION
      'Production bootstrap must leave exactly one active CEO admin (users=%, matching_admins=%)',
      total_users,
      expected_admins;
  END IF;
END $$;

INSERT INTO system_settings (key, value, description, updated_by, updated_at)
SELECT
  'prod_db_sanitized_at',
  to_jsonb(now()::text),
  'One-time production data sanitizer marker',
  id,
  now()
FROM users
WHERE email = :'admin_email'
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

COMMIT;

SELECT
  (SELECT count(*) FROM users) AS users_left,
  (SELECT email FROM users LIMIT 1) AS admin_email;
SQL

install -d -o root -g root -m 755 "$(dirname "$MARKER_FILE")"
date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER_FILE"
chmod 600 "$MARKER_FILE"

echo "Production database data sanitizer complete. Marker written to $MARKER_FILE"
