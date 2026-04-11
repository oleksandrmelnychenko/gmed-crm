ALTER TABLE consent_records
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id);

CREATE INDEX IF NOT EXISTS idx_consent_patient
    ON consent_records(patient_id)
    WHERE patient_id IS NOT NULL;
