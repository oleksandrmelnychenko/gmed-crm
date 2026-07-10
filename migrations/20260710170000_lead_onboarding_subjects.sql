-- Allow onboarding artifacts to exist before a patient record is created.
-- Existing patient-owned rows keep their current subject unchanged.

ALTER TABLE cases
    ALTER COLUMN patient_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE cases
    DROP CONSTRAINT IF EXISTS cases_subject_chk;

ALTER TABLE cases
    ADD CONSTRAINT cases_subject_chk
    CHECK (num_nonnulls(patient_id, lead_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_lead
    ON cases (lead_id)
    WHERE lead_id IS NOT NULL;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_subject_context_chk;

ALTER TABLE documents
    ADD CONSTRAINT documents_subject_context_chk
    CHECK (num_nonnulls(patient_id, lead_id, order_id, appointment_id) >= 1);

CREATE INDEX IF NOT EXISTS idx_documents_lead
    ON documents (lead_id, created_at DESC)
    WHERE lead_id IS NOT NULL;

ALTER TABLE framework_contracts
    ALTER COLUMN patient_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE framework_contracts
    DROP CONSTRAINT IF EXISTS framework_contracts_subject_chk;

ALTER TABLE framework_contracts
    ADD CONSTRAINT framework_contracts_subject_chk
    CHECK (num_nonnulls(patient_id, lead_id) = 1);

CREATE INDEX IF NOT EXISTS idx_framework_contracts_lead
    ON framework_contracts (lead_id, created_at DESC)
    WHERE lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_framework_contracts_lead_client_reference
    ON framework_contracts (lead_id, client_reference)
    WHERE lead_id IS NOT NULL AND client_reference IS NOT NULL;

ALTER TABLE orders
    ALTER COLUMN patient_id DROP NOT NULL;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_subject_chk;

ALTER TABLE orders
    ADD CONSTRAINT orders_subject_chk
    CHECK (patient_id IS NOT NULL OR source_lead_id IS NOT NULL);

ALTER TABLE order_leistungen
    ALTER COLUMN patient_id DROP NOT NULL;
