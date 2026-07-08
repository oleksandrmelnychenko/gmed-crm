-- Foundation for the staff lead-processing wizard (design v1).
-- All columns are additive and nullable/defaulted, so this is safe to apply
-- ahead of the wizard UI and does not affect existing lead/patient flows.

-- Which specialists a lead needs (e.g. traumatologist, orthopedist). Captured in
-- the wizard's qualification step and later materialised into order service-group
-- participants. Array of medical_specializations codes and/or free-text labels.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS requested_specialties JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(requested_specialties) = 'array');

-- Resumable/editable wizard progress: current step, per-step completion, and any
-- pre-conversion scratch. Keeps the staff wizard resumable (requirement #12).
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS wizard_state JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(wizard_state) = 'object');

-- Passport / travel-document tracking with an expiry date so compliance can flag
-- an expired document (requirement #6). Until now a passport was only a document
-- category with no structured number or expiry.
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS passport_number TEXT,
    ADD COLUMN IF NOT EXISTS passport_expiry DATE;

CREATE INDEX IF NOT EXISTS idx_patients_passport_expiry
    ON patients (passport_expiry)
    WHERE passport_expiry IS NOT NULL;
