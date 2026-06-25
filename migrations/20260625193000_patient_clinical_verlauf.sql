-- Patient-level Verlauf entries. Verlauf is no longer edited as a field inside
-- patient_clinical_narrative; it is its own dated clinical entity.

CREATE TABLE patient_clinical_verlauf (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    occurred_on DATE,
    note TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_patient_clinical_verlauf
    BEFORE UPDATE ON patient_clinical_verlauf
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_patient_clinical_verlauf_patient
    ON patient_clinical_verlauf (patient_id, sort_order, occurred_on);

-- Preserve existing Verlauf text from narrative versions as dated Verlauf
-- entries. The old column stays in place as legacy data but is no longer used
-- by the application contract.
INSERT INTO patient_clinical_verlauf (
    patient_id,
    provider_id,
    occurred_on,
    note,
    sort_order,
    created_at,
    updated_at
)
SELECT
    patient_id,
    NULL,
    updated_at::date,
    btrim(verlauf),
    (row_number() OVER (PARTITION BY patient_id ORDER BY updated_at, id) - 1)::integer,
    created_at,
    updated_at
FROM patient_clinical_narrative
WHERE NULLIF(btrim(verlauf), '') IS NOT NULL;
