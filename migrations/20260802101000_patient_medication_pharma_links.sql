-- Phase 5 of docs/case-patient-unification-strategy-ua.md (D7):
-- drug matching and expiry tracking learn to hang off patient_medications.
-- Case-side columns stay populated for legacy rows until Phase 6 drops them,
-- so both tables become dual-subject with an exactly-one-subject check.

ALTER TABLE medication_drug_matches
    ALTER COLUMN case_id DROP NOT NULL,
    ALTER COLUMN medication_id DROP NOT NULL;

ALTER TABLE medication_drug_matches
    ADD COLUMN IF NOT EXISTS patient_medication_id UUID
        REFERENCES patient_medications(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'medication_drug_matches_subject_chk'
    ) THEN
        ALTER TABLE medication_drug_matches
            ADD CONSTRAINT medication_drug_matches_subject_chk CHECK (
                (case_id IS NOT NULL AND medication_id IS NOT NULL AND patient_medication_id IS NULL)
                OR
                (case_id IS NULL AND medication_id IS NULL AND patient_medication_id IS NOT NULL)
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_medication_drug_matches_patient_medication_product
    ON medication_drug_matches(patient_medication_id, drug_product_id)
    WHERE patient_medication_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_medication_drug_matches_patient_medication
    ON medication_drug_matches(patient_medication_id, verification_status)
    WHERE patient_medication_id IS NOT NULL;

ALTER TABLE medication_expiry_events
    ALTER COLUMN case_id DROP NOT NULL,
    ALTER COLUMN medication_id DROP NOT NULL;

ALTER TABLE medication_expiry_events
    ADD COLUMN IF NOT EXISTS patient_medication_id UUID
        REFERENCES patient_medications(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'medication_expiry_events_subject_chk'
    ) THEN
        ALTER TABLE medication_expiry_events
            ADD CONSTRAINT medication_expiry_events_subject_chk CHECK (
                (case_id IS NOT NULL AND medication_id IS NOT NULL AND patient_medication_id IS NULL)
                OR
                (case_id IS NULL AND medication_id IS NULL AND patient_medication_id IS NOT NULL)
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_medication_expiry_pending_patient_medication
    ON medication_expiry_events(patient_medication_id)
    WHERE status = 'pending_confirmation' AND patient_medication_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_medication_expiry_patient_medication_status
    ON medication_expiry_events(patient_medication_id, status)
    WHERE patient_medication_id IS NOT NULL;
