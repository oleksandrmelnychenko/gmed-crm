ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS source_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS lead_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    ALTER TABLE patients
        ADD CONSTRAINT patients_lead_snapshot_object_chk
        CHECK (jsonb_typeof(lead_snapshot) = 'object');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

WITH source_leads AS (
    SELECT DISTINCT ON (converted_patient_id)
           leads.*
    FROM leads
    WHERE converted_patient_id IS NOT NULL
    ORDER BY converted_patient_id, status_changed_at DESC, updated_at DESC, id
)
UPDATE patients AS patient
SET source_lead_id = COALESCE(patient.source_lead_id, lead.id),
    lead_snapshot = CASE
        WHEN patient.lead_snapshot = '{}'::jsonb THEN to_jsonb(lead)
        ELSE patient.lead_snapshot
    END,
    notes = COALESCE(NULLIF(btrim(patient.notes), ''), NULLIF(btrim(lead.notes), ''))
FROM source_leads AS lead
WHERE lead.converted_patient_id = patient.id;

UPDATE cases AS case_record
SET patient_id = lead.converted_patient_id,
    lead_id = NULL,
    notes = COALESCE(NULLIF(btrim(case_record.notes), ''), NULLIF(btrim(lead.notes), ''))
FROM leads AS lead
WHERE case_record.lead_id = lead.id
  AND lead.converted_patient_id IS NOT NULL;

UPDATE documents AS document
SET patient_id = lead.converted_patient_id,
    lead_id = NULL
FROM leads AS lead
WHERE document.lead_id = lead.id
  AND lead.converted_patient_id IS NOT NULL;

UPDATE framework_contracts AS contract
SET patient_id = lead.converted_patient_id,
    lead_id = NULL
FROM leads AS lead
WHERE contract.lead_id = lead.id
  AND lead.converted_patient_id IS NOT NULL;

UPDATE orders AS order_record
SET patient_id = lead.converted_patient_id
FROM leads AS lead
WHERE order_record.source_lead_id = lead.id
  AND lead.converted_patient_id IS NOT NULL;

UPDATE order_leistungen AS service
SET patient_id = lead.converted_patient_id
FROM orders AS order_record
JOIN leads AS lead ON lead.id = order_record.source_lead_id
WHERE service.order_id = order_record.id
  AND service.patient_id IS NULL
  AND lead.converted_patient_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_source_lead_id
    ON patients (source_lead_id)
    WHERE source_lead_id IS NOT NULL;

COMMENT ON COLUMN patients.source_lead_id IS
    'Original lead that was converted into this patient.';
COMMENT ON COLUMN patients.lead_snapshot IS
    'Immutable application-level snapshot of the full lead row at conversion time.';
