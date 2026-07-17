ALTER TABLE patient_medications
    ADD COLUMN IF NOT EXISTS hold_from TEXT;

ALTER TABLE patient_clinical_narrative
    ADD COLUMN IF NOT EXISTS anamnese_at TIMESTAMPTZ;

UPDATE patient_clinical_narrative
SET anamnese_at = updated_at
WHERE anamnese_at IS NULL;

ALTER TABLE patient_clinical_narrative
    ALTER COLUMN anamnese_at SET DEFAULT now(),
    ALTER COLUMN anamnese_at SET NOT NULL;
