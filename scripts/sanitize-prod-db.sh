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
PROD_ADMIN_EMAIL="${PROD_ADMIN_EMAIL:-admin@gmed.de}"
PROD_ADMIN_NAME="${PROD_ADMIN_NAME:-System Admin}"

echo "Waiting for Postgres before production data sanitizer"
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

db_marker="$(
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
    psql \
      -v ON_ERROR_STOP=1 \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      -tA 2>/dev/null <<'SQL' || true
SELECT COALESCE((
  SELECT value #>> '{}'
  FROM system_settings
  WHERE key = 'prod_db_sanitized_at'
), '');
SQL
)"
db_marker="${db_marker//$'\r'/}"
db_marker="${db_marker//$'\n'/}"

if [[ -n "$db_marker" && "${PROD_EMPTY_DATABASE_FORCE:-false}" != "true" ]]; then
  echo "Production DB sanitizer already recorded in DB ($db_marker); writing host marker and skipping."
  install -d -o root -g root -m 755 "$(dirname "$MARKER_FILE")"
  printf '%s\n' "$db_marker" > "$MARKER_FILE"
  chmod 600 "$MARKER_FILE"
  exit 0
fi

echo "Sanitizing production database data; keeping admin '$PROD_ADMIN_EMAIL'"
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
  psql \
    -v ON_ERROR_STOP=1 \
    -v admin_email="$PROD_ADMIN_EMAIL" \
    -v admin_name="$PROD_ADMIN_NAME" \
    -v admin_password="$PROD_ADMIN_PASSWORD" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" <<'SQL'
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
  updated_at = now()
WHERE email = :'admin_email';

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
