#!/usr/bin/env bash
# One-time, fail-closed import of the approved DEV directory seed into PROD.
# The JSON bundle contains active provider/doctor profiles plus an explicit
# allowlist of patient profiles. It contains no operational or clinical rows.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/gmed/repo}"
BUNDLE_PATH="${1:-/home/gmed/gmed-bootstrap-directory-v1.json}"
EXPECTED_BUNDLE_PATH="/home/gmed/gmed-bootstrap-directory-v1.json"
MARKER_PATH="${PROD_DIRECTORY_SEED_MARKER:-/etc/gmed/prod-directory-seed-v1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: import-prod-bootstrap-directory.sh must run as root." >&2
  exit 1
fi

if [[ -e "$MARKER_PATH" ]]; then
  echo "ERROR: production directory seed marker already exists: $MARKER_PATH" >&2
  exit 1
fi

if [[ "$BUNDLE_PATH" != "$EXPECTED_BUNDLE_PATH" || ! -f "$BUNDLE_PATH" || -L "$BUNDLE_PATH" ]]; then
  echo "ERROR: seed bundle must be the regular non-symlink file $EXPECTED_BUNDLE_PATH" >&2
  exit 1
fi

bundle_owner="$(stat -c '%U' "$BUNDLE_PATH")"
bundle_mode="$(stat -c '%a' "$BUNDLE_PATH")"
bundle_size="$(stat -c '%s' "$BUNDLE_PATH")"
if [[ "$bundle_owner" != "gmed" || "$bundle_mode" != "600" ]]; then
  echo "ERROR: seed bundle must be owned by gmed with mode 600 (got owner=$bundle_owner mode=$bundle_mode)." >&2
  exit 1
fi
if (( bundle_size < 2 || bundle_size > 10485760 )); then
  echo "ERROR: seed bundle size is outside the 2 B..10 MiB safety boundary." >&2
  exit 1
fi

jq -e '
  .version == 1 and
  .manifest.provider_count == 191 and
  .manifest.doctor_count == 60 and
  .manifest.patient_count == 6 and
  .manifest.medical_specialization_count == 67 and
  (.providers | length) == 191 and
  (.provider_doctors | length) == 60 and
  (.patients | length) == 6 and
  (.medical_specializations | length) == 67 and
  ([.medical_specializations[].code] | unique | length) == 67 and
  ([.medical_specializations[] | select(
      (.code | type) != "string" or
      (.code | length) == 0 or
      (.name_en | type) != "string" or
      (.name_en | length) == 0
    )] | length) == 0 and
  (([
      .provider_specializations[].specialization_code,
      .provider_doctor_specializations[].specialization_code
    ] | unique) as $used |
    ([.medical_specializations[].code] | unique) as $available |
    (($used - $available) | length) == 0) and
  .manifest.provider_contact_count == (.provider_contacts | length) and
  .manifest.doctor_contact_count == (.provider_person_contacts | length) and
  .manifest.provider_link_count == (.provider_doctor_links | length) and
  .manifest.provider_specialization_count == (.provider_specializations | length) and
  .manifest.doctor_specialization_count == (.provider_doctor_specializations | length) and
  .manifest.provider_taxonomy_count == (.provider_taxonomy_assignments | length) and
  .manifest.provider_insurance_count == (.provider_insurances | length) and
  .manifest.doctor_insurance_count == (.provider_doctor_insurances | length) and
  .manifest.doctor_relationship_count == (.provider_doctor_relationships | length) and
  .manifest.clinical_or_operational_row_count == 0 and
  ([.patients[].patient_id] | sort) == [
    "P-20260628-0019",
    "P-20260704-0020",
    "P-20260705-0021",
    "P-20260707-0022",
    "P-20260709-0023",
    "P-20260719-0025"
  ] and
  ([.providers[] | select(.id == "54b7f99a-ab6d-48d3-9da0-38c3d0dc9f76" or .name == "454545")] | length) == 0
' "$BUNDLE_PATH" >/dev/null || {
  echo "ERROR: seed bundle manifest, allowlist, or junk-provider exclusion is invalid." >&2
  exit 1
}

bundle_sha256="$(sha256sum "$BUNDLE_PATH" | awk '{print $1}')"

# A recoverable encrypted database backup is mandatory immediately before the
# mutation. backup-postgres.sh uploads only encrypted artifacts.
bash "$REPO_DIR/scripts/backup-postgres.sh"

{
  cat <<'SQL'
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE bootstrap_payload_base64 (encoded text NOT NULL);
COPY bootstrap_payload_base64 (encoded) FROM STDIN;
SQL
  base64 -w 0 "$BUNDLE_PATH"
  printf '\n\\.\n'
  cat "$REPO_DIR/scripts/sql/import-prod-bootstrap-directory-v1.sql"
} | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" gmed-postgres \
  psql \
    --quiet \
    -v ON_ERROR_STOP=1 \
    -v admin_email="$PROD_ADMIN_EMAIL" \
    -v admin_name="$PROD_ADMIN_NAME" \
    -U "$POSTGRES_USER" \
    -d "${POSTGRES_DB:-gmed}"

# Capture the seeded state immediately, then remove the plaintext transfer
# artifact. The marker contains only operational metadata, never PHI.
bash "$REPO_DIR/scripts/backup-postgres.sh"
install -d -o root -g root -m 700 "$(dirname "$MARKER_PATH")"
printf 'completed_at=%s\nsha256=%s\nproviders=191\ndoctors=60\npatients=6\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$bundle_sha256" > "$MARKER_PATH"
chmod 600 "$MARKER_PATH"
shred -u "$BUNDLE_PATH"

echo "Production directory seed imported: providers=191 doctors=60 patients=6 specialization_catalog_refs=67 provider_contacts=337 doctor_contacts=38 provider_links=67 provider_specializations=356 doctor_specializations=87 taxonomy_assignments=191 provider_insurances=161 doctor_insurances=34 doctor_relationships=4 users=1 clinical_or_operational_rows=0"
