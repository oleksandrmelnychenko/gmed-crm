-- A diagnosis may belong to any number of entries from the shared medical
-- specialization directory. Ordering preserves the clinician's selection.

CREATE TABLE IF NOT EXISTS patient_diagnosis_specializations (
    diagnosis_id UUID NOT NULL REFERENCES patient_diagnoses(id) ON DELETE CASCADE,
    specialization_id UUID NOT NULL REFERENCES medical_specializations(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (diagnosis_id, specialization_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_diagnosis_specializations_specialization
    ON patient_diagnosis_specializations(specialization_id);
