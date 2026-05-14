-- Provider registry release enrichment.
-- Keeps the legacy columns in place and mirrors data into normalized structures.

CREATE TABLE IF NOT EXISTS medical_specializations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name_en TEXT NOT NULL,
    name_de TEXT,
    name_uk TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO medical_specializations (code, name_en, name_de, name_uk, sort_order)
VALUES
    ('allergology', 'Allergology', 'Allergologie', 'Allergology', 10),
    ('anesthesiology', 'Anesthesiology', 'Anasthesiologie', 'Anesthesiology', 20),
    ('cardiology', 'Cardiology', 'Kardiologie', 'Cardiology', 30),
    ('dermatology', 'Dermatology', 'Dermatologie', 'Dermatology', 40),
    ('endocrinology', 'Endocrinology', 'Endokrinologie', 'Endocrinology', 50),
    ('gastroenterology', 'Gastroenterology', 'Gastroenterologie', 'Gastroenterology', 60),
    ('gynecology', 'Gynecology', 'Gynakologie', 'Gynecology', 70),
    ('hematology', 'Hematology', 'Hamatologie', 'Hematology', 80),
    ('internal_medicine', 'Internal medicine', 'Innere Medizin', 'Internal medicine', 90),
    ('neurology', 'Neurology', 'Neurologie', 'Neurology', 100),
    ('oncology', 'Oncology', 'Onkologie', 'Oncology', 110),
    ('orthopedics', 'Orthopedics', 'Orthopadie', 'Orthopedics', 120),
    ('pediatrics', 'Pediatrics', 'Padiatrie', 'Pediatrics', 130),
    ('psychiatry', 'Psychiatry', 'Psychiatrie', 'Psychiatry', 140),
    ('radiology', 'Radiology', 'Radiologie', 'Radiology', 150),
    ('surgery', 'Surgery', 'Chirurgie', 'Surgery', 160),
    ('urology', 'Urology', 'Urologie', 'Urology', 170)
ON CONFLICT (code) DO UPDATE
SET name_en = EXCLUDED.name_en,
    name_de = EXCLUDED.name_de,
    name_uk = EXCLUDED.name_uk,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS parent_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS organization_level TEXT NOT NULL DEFAULT 'organization';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'providers_organization_level_check'
    ) THEN
        ALTER TABLE providers
            ADD CONSTRAINT providers_organization_level_check
            CHECK (organization_level IN ('organization', 'clinic', 'department', 'unit'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'providers_parent_not_self_check'
    ) THEN
        ALTER TABLE providers
            ADD CONSTRAINT providers_parent_not_self_check
            CHECK (parent_provider_id IS NULL OR parent_provider_id <> id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_providers_parent_provider_id
    ON providers(parent_provider_id);

CREATE TABLE IF NOT EXISTS provider_specializations (
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    specialization_id UUID NOT NULL REFERENCES medical_specializations(id) ON DELETE RESTRICT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, specialization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_specializations_primary
    ON provider_specializations(provider_id)
    WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_provider_specializations_specialization_id
    ON provider_specializations(specialization_id);

ALTER TABLE provider_doctors
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT,
    ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE provider_doctors
SET display_name = COALESCE(display_name, name)
WHERE display_name IS NULL;

CREATE TABLE IF NOT EXISTS provider_doctor_specializations (
    doctor_id UUID NOT NULL REFERENCES provider_doctors(id) ON DELETE CASCADE,
    specialization_id UUID NOT NULL REFERENCES medical_specializations(id) ON DELETE RESTRICT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (doctor_id, specialization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_doctor_specializations_primary
    ON provider_doctor_specializations(doctor_id)
    WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_provider_doctor_specializations_specialization_id
    ON provider_doctor_specializations(specialization_id);

CREATE TABLE IF NOT EXISTS provider_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('active', 'inactive', 'external', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_provider_staff_provider_id
    ON provider_staff(provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_staff_role
    ON provider_staff(role);

CREATE TABLE IF NOT EXISTS provider_person_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE CASCADE,
    staff_id UUID REFERENCES provider_staff(id) ON DELETE CASCADE,
    contact_kind TEXT NOT NULL,
    contact_type TEXT NOT NULL DEFAULT 'work',
    value TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (contact_kind IN ('phone', 'email')),
    CHECK (contact_type IN ('work', 'private', 'other')),
    CHECK ((doctor_id IS NOT NULL)::int + (staff_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS idx_provider_person_contacts_provider_id
    ON provider_person_contacts(provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_person_contacts_doctor_id
    ON provider_person_contacts(doctor_id);

CREATE INDEX IF NOT EXISTS idx_provider_person_contacts_staff_id
    ON provider_person_contacts(staff_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_doctor_primary_contact
    ON provider_person_contacts(doctor_id, contact_kind)
    WHERE doctor_id IS NOT NULL AND is_primary;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_staff_primary_contact
    ON provider_person_contacts(staff_id, contact_kind)
    WHERE staff_id IS NOT NULL AND is_primary;

ALTER TABLE service_catalog
    ADD COLUMN IF NOT EXISTS price_type TEXT NOT NULL DEFAULT 'fixed',
    ADD COLUMN IF NOT EXISTS price_from NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS price_to NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS price_note TEXT;

UPDATE service_catalog
SET price_from = COALESCE(price_from, price),
    price_to = COALESCE(price_to, price),
    price_type = COALESCE(NULLIF(price_type, ''), 'fixed')
WHERE price_from IS NULL OR price_to IS NULL OR price_type IS NULL OR price_type = '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_price_type_check'
    ) THEN
        ALTER TABLE service_catalog
            ADD CONSTRAINT service_catalog_price_type_check
            CHECK (price_type IN ('fixed', 'range', 'on_request'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_price_range_check'
    ) THEN
        ALTER TABLE service_catalog
            ADD CONSTRAINT service_catalog_price_range_check
            CHECK (
                price_type = 'on_request'
                OR price_from IS NULL
                OR price_to IS NULL
                OR price_to >= price_from
            );
    END IF;
END $$;

WITH raw_labels AS (
    SELECT DISTINCT btrim(fachbereich) AS label
    FROM providers
    WHERE NULLIF(btrim(fachbereich), '') IS NOT NULL
    UNION
    SELECT DISTINCT btrim(fachbereich) AS label
    FROM provider_doctors
    WHERE NULLIF(btrim(fachbereich), '') IS NOT NULL
),
normalized AS (
    SELECT
        label,
        lower(btrim(regexp_replace(label, '[^[:alnum:]]+', '_', 'g'), '_')) AS code
    FROM raw_labels
)
INSERT INTO medical_specializations (code, name_en, name_de, name_uk, sort_order)
SELECT COALESCE(NULLIF(code, ''), 'custom_' || md5(label)), label, label, label, 900
FROM normalized
ON CONFLICT (code) DO UPDATE
SET name_en = EXCLUDED.name_en,
    name_de = COALESCE(medical_specializations.name_de, EXCLUDED.name_de),
    name_uk = COALESCE(medical_specializations.name_uk, EXCLUDED.name_uk),
    updated_at = now();

INSERT INTO provider_specializations (provider_id, specialization_id, is_primary)
SELECT p.id, s.id, TRUE
FROM providers p
JOIN medical_specializations s
  ON s.code = COALESCE(
      NULLIF(lower(btrim(regexp_replace(btrim(p.fachbereich), '[^[:alnum:]]+', '_', 'g'), '_')), ''),
      'custom_' || md5(btrim(p.fachbereich))
  )
WHERE NULLIF(btrim(p.fachbereich), '') IS NOT NULL
ON CONFLICT (provider_id, specialization_id) DO UPDATE
SET is_primary = TRUE;

INSERT INTO provider_doctor_specializations (doctor_id, specialization_id, is_primary)
SELECT d.id, s.id, TRUE
FROM provider_doctors d
JOIN medical_specializations s
  ON s.code = COALESCE(
      NULLIF(lower(btrim(regexp_replace(btrim(d.fachbereich), '[^[:alnum:]]+', '_', 'g'), '_')), ''),
      'custom_' || md5(btrim(d.fachbereich))
  )
WHERE NULLIF(btrim(d.fachbereich), '') IS NOT NULL
ON CONFLICT (doctor_id, specialization_id) DO UPDATE
SET is_primary = TRUE;

INSERT INTO provider_person_contacts (provider_id, doctor_id, contact_kind, contact_type, value, is_primary)
SELECT provider_id, id, 'phone', 'work', btrim(phone), TRUE
FROM provider_doctors
WHERE NULLIF(btrim(phone), '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO provider_person_contacts (provider_id, doctor_id, contact_kind, contact_type, value, is_primary)
SELECT provider_id, id, 'email', 'work', btrim(email), TRUE
FROM provider_doctors
WHERE NULLIF(btrim(email), '') IS NOT NULL
ON CONFLICT DO NOTHING;
