CREATE TEMP VIEW bootstrap_payload AS
SELECT convert_from(decode(encoded, 'base64'), 'UTF8')::jsonb AS doc
FROM bootstrap_payload_base64;

CREATE TEMP TABLE bootstrap_context (
  admin_email text NOT NULL,
  admin_name text NOT NULL
);
INSERT INTO bootstrap_context (admin_email, admin_name)
VALUES (:'admin_email', :'admin_name');

DO $$
DECLARE
  payload jsonb := (SELECT doc FROM bootstrap_payload);
  ceo_count bigint;
  total_user_count bigint;
  approved_email_count bigint;
  ceo_role_count bigint;
  active_user_count bigint;
  retained_ceo_id uuid;
  user_fk record;
BEGIN
  IF (payload->>'version')::integer <> 1
     OR jsonb_array_length(payload->'providers') <> 191
     OR jsonb_array_length(payload->'provider_doctors') <> 60
     OR jsonb_array_length(payload->'patients') <> 6
     OR jsonb_array_length(payload->'medical_specializations') <> 67 THEN
    RAISE EXCEPTION 'bootstrap directory bundle count validation failed';
  END IF;

  IF EXISTS (SELECT 1 FROM providers)
     OR EXISTS (SELECT 1 FROM provider_doctors)
     OR EXISTS (SELECT 1 FROM patients) THEN
    RAISE EXCEPTION 'production provider/doctor/patient destination is not empty';
  END IF;

  SELECT count(*) INTO ceo_count
  FROM users
  WHERE role = 'ceo'
    AND is_active = true;

  SELECT id INTO retained_ceo_id
  FROM users
  WHERE role = 'ceo'
    AND is_active = true
  LIMIT 1;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE lower(email) = lower((SELECT admin_email FROM bootstrap_context))
    ),
    count(*) FILTER (WHERE role = 'ceo'),
    count(*) FILTER (WHERE is_active = true)
  INTO total_user_count, approved_email_count, ceo_role_count, active_user_count
  FROM users;

  IF ceo_count <> 1 THEN
    RAISE EXCEPTION
      'production must contain exactly one active CEO before account normalization (users=%, approved_email=%, ceo_role=%, active=%, active_ceo=%)',
      total_user_count,
      approved_email_count,
      ceo_role_count,
      active_user_count,
      ceo_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE lower(email) = lower((SELECT admin_email FROM bootstrap_context))
      AND id <> retained_ceo_id
  ) THEN
    RAISE EXCEPTION 'approved CEO email belongs to a different account';
  END IF;

  -- The approved production shape is one account only. Preserve the sole
  -- active CEO (including the current password and MFA state), detach nullable
  -- references from any stale account, then remove those stale accounts.
  FOR user_fk IN
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
      user_fk.table_schema,
      user_fk.table_name,
      user_fk.column_name,
      user_fk.column_name,
      user_fk.column_name
    )
    USING retained_ceo_id;
  END LOOP;

  DELETE FROM users WHERE id <> retained_ceo_id;

  UPDATE users
  SET email = (SELECT admin_email FROM bootstrap_context),
      name = (SELECT admin_name FROM bootstrap_context),
      role = 'ceo',
      is_active = true,
      updated_at = now()
  WHERE id = retained_ceo_id;

  SELECT count(*) INTO ceo_count
  FROM users
  WHERE lower(email) = lower((SELECT admin_email FROM bootstrap_context))
    AND role = 'ceo'
    AND is_active = true;

  IF (SELECT count(*) FROM users) <> 1 OR ceo_count <> 1 THEN
    RAISE EXCEPTION 'production account normalization did not leave exactly the approved active CEO';
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

INSERT INTO medical_specializations (
  code,
  name_en,
  name_de,
  name_ru,
  name_es,
  is_active,
  sort_order,
  deleted_at
)
SELECT
  imported.code,
  imported.name_en,
  imported.name_de,
  imported.name_ru,
  imported.name_es,
  imported.is_active,
  imported.sort_order,
  imported.deleted_at
FROM bootstrap_payload payload,
LATERAL jsonb_to_recordset(payload.doc->'medical_specializations') AS imported(
  code text,
  name_en text,
  name_de text,
  name_ru text,
  name_es text,
  is_active boolean,
  sort_order integer,
  deleted_at timestamptz
)
ON CONFLICT (code) DO UPDATE
SET name_en = EXCLUDED.name_en,
    name_de = EXCLUDED.name_de,
    name_ru = EXCLUDED.name_ru,
    name_es = EXCLUDED.name_es,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = now();

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
DECLARE
  actual_counts text;
BEGIN
  SELECT concat_ws('|',
    (SELECT count(*) FROM providers),
    (SELECT count(*) FROM provider_doctors),
    (SELECT count(*) FROM patients),
    (SELECT count(*) FROM provider_contacts),
    (SELECT count(*) FROM provider_person_contacts),
    (SELECT count(*) FROM provider_doctor_links),
    (SELECT count(*) FROM provider_specializations),
    (SELECT count(*) FROM provider_doctor_specializations),
    (SELECT count(*) FROM provider_taxonomy_assignments),
    (SELECT count(*) FROM provider_insurances),
    (SELECT count(*) FROM provider_doctor_insurances),
    (SELECT count(*) FROM provider_doctor_relationships),
    (SELECT count(*) FROM users),
    (SELECT count(*) FROM users
       WHERE lower(email) = lower((SELECT admin_email FROM bootstrap_context))
         AND role = 'ceo'
         AND is_active = true),
    (SELECT count(*) FROM audit_log
       WHERE action = 'bootstrap_directory_import'
         AND entity_type = 'system')
  ) INTO actual_counts;

  IF (SELECT count(*) FROM providers) <> 191
     OR (SELECT count(*) FROM provider_doctors) <> 60
     OR (SELECT count(*) FROM patients) <> 6
     OR (SELECT count(*) FROM provider_contacts) <> 337
     OR (SELECT count(*) FROM provider_person_contacts) <> 38
     OR (SELECT count(*) FROM provider_doctor_links) <> 67
     OR (SELECT count(*)
           FROM medical_specializations specialization
           WHERE specialization.code IN (
             SELECT imported.code
             FROM bootstrap_payload payload,
             LATERAL jsonb_to_recordset(payload.doc->'medical_specializations') AS imported(code text)
           )) <> 67
     OR (SELECT count(*) FROM provider_specializations) <> 356
     OR (SELECT count(*) FROM provider_doctor_specializations) <> 87
     OR (SELECT count(*) FROM provider_taxonomy_assignments) <> 191
     OR (SELECT count(*) FROM provider_insurances) <> 161
     OR (SELECT count(*) FROM provider_doctor_insurances) <> 34
     OR (SELECT count(*) FROM provider_doctor_relationships) <> 4
     OR (SELECT count(*) FROM users) <> 1
     OR (SELECT count(*) FROM users
           WHERE lower(email) = lower((SELECT admin_email FROM bootstrap_context))
             AND role = 'ceo'
             AND is_active = true) <> 1
     OR (SELECT count(*) FROM audit_log
           WHERE action = 'bootstrap_directory_import'
             AND entity_type = 'system') <> 1
     OR EXISTS (SELECT 1 FROM providers WHERE id = '54b7f99a-ab6d-48d3-9da0-38c3d0dc9f76' OR name = '454545')
     OR (SELECT array_agg(patient_id ORDER BY patient_id) FROM patients) <> ARRAY[
       'P-20260628-0019',
       'P-20260704-0020',
       'P-20260705-0021',
       'P-20260707-0022',
       'P-20260709-0023',
       'P-20260719-0025'
     ]::text[] THEN
    RAISE EXCEPTION
      'post-import production invariant failed (providers|doctors|patients|provider_contacts|doctor_contacts|provider_links|provider_specializations|doctor_specializations|taxonomy|provider_insurances|doctor_insurances|doctor_relationships|users|approved_ceo|import_audit=%)',
      actual_counts;
  END IF;
END $$;

COMMIT;
