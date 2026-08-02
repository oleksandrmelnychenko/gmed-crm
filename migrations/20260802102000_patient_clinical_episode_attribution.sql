-- Phase 4 of docs/case-patient-unification-strategy-ua.md (D5 + Impfstatus move):
-- clinical facts stay on the patient; an optional case_id records which episode
-- established them. ON DELETE SET NULL — deleting an episode never deletes
-- clinical facts. Impfstatus becomes patient state (was a case 1:1 table).

ALTER TABLE patient_diagnoses
    ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_patient_diagnoses_case ON patient_diagnoses(case_id)
    WHERE case_id IS NOT NULL;

ALTER TABLE patient_examinations
    ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_patient_examinations_case ON patient_examinations(case_id)
    WHERE case_id IS NOT NULL;

ALTER TABLE patient_procedures
    ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_patient_procedures_case ON patient_procedures(case_id)
    WHERE case_id IS NOT NULL;

ALTER TABLE patient_clinical_verlauf
    ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_patient_clinical_verlauf_case ON patient_clinical_verlauf(case_id)
    WHERE case_id IS NOT NULL;

ALTER TABLE patient_clinical_narrative
    ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_patient_clinical_narrative_case ON patient_clinical_narrative(case_id)
    WHERE case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS patient_impfstatus (
    patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    status_text TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
