CREATE TABLE IF NOT EXISTS patient_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    contact_kind TEXT NOT NULL,
    contact_type TEXT NOT NULL DEFAULT 'private',
    value TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (contact_kind IN ('phone', 'email')),
    CHECK (contact_type IN ('work', 'private', 'other')),
    CHECK (length(trim(value)) BETWEEN 1 AND 255),
    CHECK (notes IS NULL OR length(notes) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_patient_contacts_patient_id
    ON patient_contacts(patient_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_contacts_primary
    ON patient_contacts(patient_id, contact_kind)
    WHERE is_primary;

DROP TRIGGER IF EXISTS set_updated_at_patient_contacts ON patient_contacts;
CREATE TRIGGER set_updated_at_patient_contacts
    BEFORE UPDATE ON patient_contacts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO patient_contacts (patient_id, contact_kind, contact_type, value, is_primary)
SELECT p.id, 'phone', 'private', btrim(p.phone_primary), TRUE
FROM patients p
WHERE NULLIF(btrim(p.phone_primary), '') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM patient_contacts pc
      WHERE pc.patient_id = p.id
        AND pc.contact_kind = 'phone'
        AND pc.value = btrim(p.phone_primary)
  );

INSERT INTO patient_contacts (patient_id, contact_kind, contact_type, value, is_primary)
SELECT p.id, 'phone', 'private', btrim(p.phone_secondary), FALSE
FROM patients p
WHERE NULLIF(btrim(p.phone_secondary), '') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM patient_contacts pc
      WHERE pc.patient_id = p.id
        AND pc.contact_kind = 'phone'
        AND pc.value = btrim(p.phone_secondary)
  );

INSERT INTO patient_contacts (patient_id, contact_kind, contact_type, value, is_primary)
SELECT p.id, 'email', 'private', btrim(p.email), TRUE
FROM patients p
WHERE NULLIF(btrim(p.email), '') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM patient_contacts pc
      WHERE pc.patient_id = p.id
        AND pc.contact_kind = 'email'
        AND pc.value = btrim(p.email)
  );
