-- Sign-in e-mails for patient logins too (owner request 2026-10-05: the
-- patients table gets the same login row as the leads table). A log row
-- belongs to exactly one lead or one patient; it goes with the patient when
-- the record is deleted or anonymised (`anonymize_patient_identity`).
ALTER TABLE portal_login_emails
    ALTER COLUMN lead_id DROP NOT NULL,
    ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    ADD CONSTRAINT portal_login_emails_one_subject
        CHECK (num_nonnulls(lead_id, patient_id) = 1);

CREATE INDEX portal_login_emails_patient_idx
    ON portal_login_emails (patient_id, created_at DESC)
    WHERE patient_id IS NOT NULL;
