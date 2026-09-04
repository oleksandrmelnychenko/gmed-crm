ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS referrer_patient_id UUID
        REFERENCES patients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_referrer_patient
    ON leads(referrer_patient_id)
    WHERE referrer_patient_id IS NOT NULL;
