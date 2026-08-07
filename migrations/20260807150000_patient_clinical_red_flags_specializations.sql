-- Red flags are recorded as free text on the three core clinical forms.
ALTER TABLE patient_diagnoses
    ADD COLUMN IF NOT EXISTS red_flags TEXT;

ALTER TABLE patient_examinations
    ADD COLUMN IF NOT EXISTS red_flags TEXT;

ALTER TABLE patient_clinical_narrative
    ADD COLUMN IF NOT EXISTS red_flags TEXT;

-- An anamnesis version and an examination may each be relevant to any number
-- of entries from the shared medical-specialization directory. Ordering keeps
-- the clinician's selection stable across save/reload and version snapshots.
CREATE TABLE IF NOT EXISTS patient_narrative_specializations (
    narrative_id UUID NOT NULL REFERENCES patient_clinical_narrative(id) ON DELETE CASCADE,
    specialization_id UUID NOT NULL REFERENCES medical_specializations(id) ON DELETE RESTRICT,
    narrative_text TEXT,
    assessment_text TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (narrative_id, specialization_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_narrative_specializations_specialization
    ON patient_narrative_specializations(specialization_id);

CREATE TABLE IF NOT EXISTS patient_examination_specializations (
    examination_id UUID NOT NULL REFERENCES patient_examinations(id) ON DELETE CASCADE,
    specialization_id UUID NOT NULL REFERENCES medical_specializations(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (examination_id, specialization_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_examination_specializations_specialization
    ON patient_examination_specializations(specialization_id);
