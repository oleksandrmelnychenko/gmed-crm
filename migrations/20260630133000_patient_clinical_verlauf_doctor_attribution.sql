ALTER TABLE patient_clinical_verlauf
    ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_clinical_verlauf_doctor
    ON patient_clinical_verlauf (doctor_id);
