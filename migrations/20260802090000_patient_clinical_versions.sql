-- Audit and retention parity for the patient-level clinical record
-- (docs/case-patient-unification-strategy-ua.md, D6). Mirrors case_versions /
-- case retention hardening (20260413090000) at the patient level so the
-- patient record can become the clinical source of truth without losing the
-- append-only change trail.

CREATE TABLE IF NOT EXISTS patient_clinical_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    -- Episode attribution arrives in a later phase; intentionally no FK so the
    -- immutability trigger below can never conflict with referential actions.
    case_id UUID,
    section TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    changed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_clinical_versions_patient
    ON patient_clinical_versions(patient_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_patient_clinical_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'patient_clinical_versions is immutable — updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS patient_clinical_versions_immutable ON patient_clinical_versions;

CREATE TRIGGER patient_clinical_versions_immutable
    BEFORE UPDATE OR DELETE ON patient_clinical_versions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_patient_clinical_version_mutation();

ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS clinical_retention_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_clinical_update_at TIMESTAMPTZ;

UPDATE patients p
SET clinical_retention_until = episodes.max_retention
FROM (
    SELECT patient_id, MAX(retention_until) AS max_retention
    FROM cases
    WHERE patient_id IS NOT NULL
    GROUP BY patient_id
) AS episodes
WHERE episodes.patient_id = p.id
  AND p.clinical_retention_until IS NULL;

UPDATE patients p
SET last_clinical_update_at = episodes.max_update
FROM (
    SELECT patient_id, MAX(last_clinical_update_at) AS max_update
    FROM cases
    WHERE patient_id IS NOT NULL
    GROUP BY patient_id
) AS episodes
WHERE episodes.patient_id = p.id
  AND p.last_clinical_update_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patients_clinical_retention_until
    ON patients(clinical_retention_until);
