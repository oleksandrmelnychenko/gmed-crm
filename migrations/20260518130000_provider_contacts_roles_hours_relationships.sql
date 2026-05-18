-- CRM provider enrichment: provider-level contacts, doctor roles, gender/opening hours,
-- and internal doctor-to-doctor relationships.

ALTER TABLE provider_doctors
    ADD COLUMN IF NOT EXISTS role_code TEXT,
    ADD COLUMN IF NOT EXISTS role_label TEXT,
    ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS opening_hours TEXT;

ALTER TABLE provider_staff
    ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS opening_hours TEXT;

UPDATE provider_doctors SET gender = 'unknown' WHERE gender IS NULL;
ALTER TABLE provider_doctors
    ALTER COLUMN gender SET DEFAULT 'unknown',
    ALTER COLUMN gender SET NOT NULL;

UPDATE provider_staff SET gender = 'unknown' WHERE gender IS NULL;
ALTER TABLE provider_staff
    ALTER COLUMN gender SET DEFAULT 'unknown',
    ALTER COLUMN gender SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_doctors_role_code_check'
          AND conrelid = 'provider_doctors'::regclass
    ) THEN
        ALTER TABLE provider_doctors
            ADD CONSTRAINT provider_doctors_role_code_check
            CHECK (
                role_code IS NULL OR role_code IN (
                    'clinical_director',
                    'chefarzt',
                    'oberarzt',
                    'facharzt',
                    'assistenzarzt',
                    'head_of_department',
                    'other'
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_doctors_role_label_length_check'
          AND conrelid = 'provider_doctors'::regclass
    ) THEN
        ALTER TABLE provider_doctors
            ADD CONSTRAINT provider_doctors_role_label_length_check
            CHECK (role_label IS NULL OR length(role_label) <= 120);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_doctors_gender_check'
          AND conrelid = 'provider_doctors'::regclass
    ) THEN
        ALTER TABLE provider_doctors
            ADD CONSTRAINT provider_doctors_gender_check
            CHECK (gender IN ('male', 'female', 'unknown'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_doctors_opening_hours_length_check'
          AND conrelid = 'provider_doctors'::regclass
    ) THEN
        ALTER TABLE provider_doctors
            ADD CONSTRAINT provider_doctors_opening_hours_length_check
            CHECK (opening_hours IS NULL OR length(opening_hours) <= 4000);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_staff_gender_check'
          AND conrelid = 'provider_staff'::regclass
    ) THEN
        ALTER TABLE provider_staff
            ADD CONSTRAINT provider_staff_gender_check
            CHECK (gender IN ('male', 'female', 'unknown'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_staff_opening_hours_length_check'
          AND conrelid = 'provider_staff'::regclass
    ) THEN
        ALTER TABLE provider_staff
            ADD CONSTRAINT provider_staff_opening_hours_length_check
            CHECK (opening_hours IS NULL OR length(opening_hours) <= 4000);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS provider_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    label TEXT,
    department TEXT,
    contact_kind TEXT NOT NULL,
    contact_type TEXT NOT NULL DEFAULT 'work',
    value TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (contact_kind IN ('phone', 'email')),
    CHECK (contact_type IN ('work', 'department', 'other')),
    CHECK (length(btrim(value)) > 0 AND length(value) <= 255),
    CHECK (label IS NULL OR length(label) <= 120),
    CHECK (department IS NULL OR length(department) <= 120)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_contacts_value_length_check'
          AND conrelid = 'provider_contacts'::regclass
    ) THEN
        ALTER TABLE provider_contacts
            ADD CONSTRAINT provider_contacts_value_length_check
            CHECK (length(btrim(value)) > 0 AND length(value) <= 255);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_contacts_label_length_check'
          AND conrelid = 'provider_contacts'::regclass
    ) THEN
        ALTER TABLE provider_contacts
            ADD CONSTRAINT provider_contacts_label_length_check
            CHECK (label IS NULL OR length(label) <= 120);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_contacts_department_length_check'
          AND conrelid = 'provider_contacts'::regclass
    ) THEN
        ALTER TABLE provider_contacts
            ADD CONSTRAINT provider_contacts_department_length_check
            CHECK (department IS NULL OR length(department) <= 120);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_contacts_provider_id
    ON provider_contacts(provider_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_contacts_primary
    ON provider_contacts(provider_id, contact_kind)
    WHERE is_primary;

DROP TRIGGER IF EXISTS set_updated_at_provider_contacts ON provider_contacts;
CREATE TRIGGER set_updated_at_provider_contacts
    BEFORE UPDATE ON provider_contacts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS provider_doctor_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_doctor_id UUID NOT NULL REFERENCES provider_doctors(id) ON DELETE CASCADE,
    target_doctor_id UUID NOT NULL REFERENCES provider_doctors(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL DEFAULT 'professional',
    description TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (source_doctor_id <> target_doctor_id),
    CHECK (relationship_type IN ('professional', 'referral', 'knows', 'approach_via', 'other')),
    CHECK (description IS NULL OR length(description) <= 2000),
    CHECK (notes IS NULL OR length(notes) <= 2000)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_doctor_relationships_description_length_check'
          AND conrelid = 'provider_doctor_relationships'::regclass
    ) THEN
        ALTER TABLE provider_doctor_relationships
            ADD CONSTRAINT provider_doctor_relationships_description_length_check
            CHECK (description IS NULL OR length(description) <= 2000);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_doctor_relationships_notes_length_check'
          AND conrelid = 'provider_doctor_relationships'::regclass
    ) THEN
        ALTER TABLE provider_doctor_relationships
            ADD CONSTRAINT provider_doctor_relationships_notes_length_check
            CHECK (notes IS NULL OR length(notes) <= 2000);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_doctor_relationships_source
    ON provider_doctor_relationships(source_doctor_id);

CREATE INDEX IF NOT EXISTS idx_provider_doctor_relationships_target
    ON provider_doctor_relationships(target_doctor_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_doctor_relationships_active
    ON provider_doctor_relationships(source_doctor_id, target_doctor_id, relationship_type)
    WHERE is_active;

DROP TRIGGER IF EXISTS set_updated_at_provider_doctor_relationships ON provider_doctor_relationships;
CREATE TRIGGER set_updated_at_provider_doctor_relationships
    BEFORE UPDATE ON provider_doctor_relationships
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO provider_contacts (provider_id, contact_kind, contact_type, value, is_primary)
SELECT id, 'phone', 'work', phone, TRUE
FROM providers
WHERE phone IS NOT NULL
  AND trim(phone) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM provider_contacts pc
      WHERE pc.provider_id = providers.id
        AND pc.contact_kind = 'phone'
  );

INSERT INTO provider_contacts (provider_id, contact_kind, contact_type, value, is_primary)
SELECT id, 'email', 'work', email, TRUE
FROM providers
WHERE email IS NOT NULL
  AND trim(email) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM provider_contacts pc
      WHERE pc.provider_id = providers.id
        AND pc.contact_kind = 'email'
  );
