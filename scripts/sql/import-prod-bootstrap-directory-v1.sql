CREATE TEMP VIEW bootstrap_payload AS
SELECT convert_from(decode(encoded, 'base64'), 'UTF8')::jsonb AS doc
FROM bootstrap_payload_base64;

CREATE TEMP TABLE bootstrap_context (admin_email text NOT NULL);
INSERT INTO bootstrap_context (admin_email) VALUES (:'admin_email');

DO $$
DECLARE
  payload jsonb := (SELECT doc FROM bootstrap_payload);
  ceo_count bigint;
  total_user_count bigint;
  approved_email_count bigint;
  ceo_role_count bigint;
  active_user_count bigint;
BEGIN
  IF (payload->>'version')::integer <> 1
     OR jsonb_array_length(payload->'providers') <> 191
     OR jsonb_array_length(payload->'provider_doctors') <> 60
     OR jsonb_array_length(payload->'patients') <> 6 THEN
    RAISE EXCEPTION 'bootstrap directory bundle count validation failed';
  END IF;

  IF EXISTS (SELECT 1 FROM providers)
     OR EXISTS (SELECT 1 FROM provider_doctors)
     OR EXISTS (SELECT 1 FROM patients) THEN
    RAISE EXCEPTION 'production provider/doctor/patient destination is not empty';
  END IF;

  SELECT count(*) INTO ceo_count
  FROM users
  WHERE lower(email) = lower((SELECT admin_email FROM bootstrap_context))
    AND role = 'ceo'
    AND is_active = true;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE lower(email) = lower((SELECT admin_email FROM bootstrap_context))
    ),
    count(*) FILTER (WHERE role = 'ceo'),
    count(*) FILTER (WHERE is_active = true)
  INTO total_user_count, approved_email_count, ceo_role_count, active_user_count
  FROM users;

  IF total_user_count <> 1 OR ceo_count <> 1 THEN
    RAISE EXCEPTION
      'production must contain exactly the approved active CEO account (users=%, approved_email=%, ceo_role=%, active=%, approved_active_ceo=%)',
      total_user_count,
      approved_email_count,
      ceo_role_count,
      active_user_count,
      ceo_count;
  END IF;
END $$;

INSERT INTO providers
SELECT imported.*
FROM bootstrap_payload payload,
LATERAL jsonb_populate_recordset(NULL::providers, payload.doc->'providers') imported;

INSERT INTO provider_doctors
SELECT imported.*
FROM bootstrap_payload payload,
LATERAL jsonb_populate_recordset(NULL::provider_doctors, payload.doc->'provider_doctors') imported;

INSERT INTO provider_doctor_links (provider_id, doctor_id, created_at)
SELECT imported.provider_id, imported.doctor_id, imported.created_at
FROM bootstrap_payload payload,
LATERAL jsonb_to_recordset(payload.doc->'provider_doctor_links') AS imported(
  provider_id uuid,
  doctor_id uuid,
  created_at timestamptz
)
ON CONFLICT (provider_id, doctor_id) DO NOTHING;

INSERT INTO provider_contacts
SELECT imported.*
FROM bootstrap_payload payload,
LATERAL jsonb_populate_recordset(NULL::provider_contacts, payload.doc->'provider_contacts') imported;

INSERT INTO provider_person_contacts
SELECT imported.*
FROM bootstrap_payload payload,
LATERAL jsonb_populate_recordset(NULL::provider_person_contacts, payload.doc->'provider_person_contacts') imported;

INSERT INTO provider_specializations (provider_id, specialization_id, is_primary, created_at)
SELECT imported.provider_id, specialization.id, imported.is_primary, imported.created_at
FROM bootstrap_payload payload,
LATERAL jsonb_to_recordset(payload.doc->'provider_specializations') AS imported(
  provider_id uuid,
  specialization_code text,
  is_primary boolean,
  created_at timestamptz
)
JOIN medical_specializations specialization ON specialization.code = imported.specialization_code;

INSERT INTO provider_doctor_specializations (doctor_id, specialization_id, is_primary, created_at)
SELECT imported.doctor_id, specialization.id, imported.is_primary, imported.created_at
FROM bootstrap_payload payload,
LATERAL jsonb_to_recordset(payload.doc->'provider_doctor_specializations') AS imported(
  doctor_id uuid,
  specialization_code text,
  is_primary boolean,
  created_at timestamptz
)
JOIN medical_specializations specialization ON specialization.code = imported.specialization_code;

INSERT INTO provider_taxonomy_assignments (provider_id, taxonomy_node_id, is_primary, created_at)
SELECT imported.provider_id, taxonomy.id, imported.is_primary, imported.created_at
FROM bootstrap_payload payload,
LATERAL jsonb_to_recordset(payload.doc->'provider_taxonomy_assignments') AS imported(
  provider_id uuid,
  taxonomy_code text,
  is_primary boolean,
  created_at timestamptz
)
JOIN provider_taxonomy_nodes taxonomy ON taxonomy.code = imported.taxonomy_code;

INSERT INTO insurance_providers (name)
SELECT DISTINCT imported.insurance_name
FROM bootstrap_payload payload,
LATERAL (
  SELECT insurance_name
  FROM jsonb_to_recordset(payload.doc->'provider_insurances') AS provider_item(insurance_name text)
  UNION
  SELECT insurance_name
  FROM jsonb_to_recordset(payload.doc->'provider_doctor_insurances') AS doctor_item(insurance_name text)
) imported
WHERE nullif(btrim(imported.insurance_name), '') IS NOT NULL
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO provider_insurances (provider_id, insurance_provider_id, created_at)
SELECT imported.provider_id, insurance.id, imported.created_at
FROM bootstrap_payload payload,
LATERAL jsonb_to_recordset(payload.doc->'provider_insurances') AS imported(
  provider_id uuid,
  insurance_name text,
  created_at timestamptz
)
JOIN insurance_providers insurance
  ON insurance.normalized_name = lower(regexp_replace(btrim(imported.insurance_name), '[[:space:]]+', ' ', 'g'));

INSERT INTO provider_doctor_insurances (doctor_id, insurance_provider_id, created_at)
SELECT imported.doctor_id, insurance.id, imported.created_at
FROM bootstrap_payload payload,
LATERAL jsonb_to_recordset(payload.doc->'provider_doctor_insurances') AS imported(
  doctor_id uuid,
  insurance_name text,
  created_at timestamptz
)
JOIN insurance_providers insurance
  ON insurance.normalized_name = lower(regexp_replace(btrim(imported.insurance_name), '[[:space:]]+', ' ', 'g'));

INSERT INTO provider_doctor_relationships
SELECT imported.*
FROM bootstrap_payload payload,
LATERAL jsonb_populate_recordset(
  NULL::provider_doctor_relationships,
  payload.doc->'provider_doctor_relationships'
) imported;

CREATE TEMP TABLE imported_patients AS
SELECT * FROM patients WITH NO DATA;
INSERT INTO imported_patients
SELECT imported.*
FROM bootstrap_payload payload,
LATERAL jsonb_populate_recordset(NULL::patients, payload.doc->'patients') imported;

UPDATE imported_patients
SET created_by = (
      SELECT id FROM users
      WHERE lower(email) = lower(:'admin_email')
        AND role = 'ceo'
        AND is_active = true
    ),
    source_lead_id = NULL;

INSERT INTO patients SELECT * FROM imported_patients;

DO $$
BEGIN
  PERFORM setval(
    'patient_id_seq',
    GREATEST(
      (SELECT last_value FROM patient_id_seq),
      (SELECT max((regexp_match(patient_id, '([0-9]+)$'))[1]::bigint) FROM patients)
    ),
    true
  );
END $$;

INSERT INTO audit_log (user_id, action, entity_type, context)
SELECT id,
       'bootstrap_directory_import',
       'system',
       jsonb_build_object(
         'version', 1,
         'providers', 191,
         'doctors', 60,
         'patients', 6,
         'clinical_or_operational_rows', 0
       )
FROM users
WHERE lower(email) = lower(:'admin_email')
  AND role = 'ceo'
  AND is_active = true;

DO $$
BEGIN
  IF (SELECT count(*) FROM providers) <> 191
     OR (SELECT count(*) FROM provider_doctors) <> 60
     OR (SELECT count(*) FROM patients) <> 6
     OR EXISTS (SELECT 1 FROM providers WHERE id = '54b7f99a-ab6d-48d3-9da0-38c3d0dc9f76' OR name = '454545')
     OR (SELECT array_agg(patient_id ORDER BY patient_id) FROM patients) <> ARRAY[
       'P-20260628-0019',
       'P-20260704-0020',
       'P-20260705-0021',
       'P-20260707-0022',
       'P-20260709-0023',
       'P-20260719-0025'
     ]::text[] THEN
    RAISE EXCEPTION 'post-import production invariant failed';
  END IF;
END $$;

COMMIT;
