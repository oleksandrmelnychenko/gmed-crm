ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS portal_visible BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS hide_amounts_from_patient BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS line_items_visible_to_patient BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS pdf_visible_to_patient BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS visibility_note TEXT,
    ADD COLUMN IF NOT EXISTS visibility_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visibility_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payer_patient_relation_id UUID REFERENCES patient_relations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payer_contact_name TEXT,
    ADD COLUMN IF NOT EXISTS payer_contact_email TEXT,
    ADD COLUMN IF NOT EXISTS payer_contact_phone TEXT,
    ADD COLUMN IF NOT EXISTS payer_contact_relationship TEXT,
    ADD COLUMN IF NOT EXISTS payer_notes TEXT,
    ADD COLUMN IF NOT EXISTS payer_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payer_updated_at TIMESTAMPTZ;

ALTER TABLE invoices
    ADD CONSTRAINT invoices_payer_contact_or_relation_chk
    CHECK (
        payer_patient_relation_id IS NULL
        OR payer_contact_name IS NULL
        OR length(trim(payer_contact_name)) > 0
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_invoices_portal_visibility
    ON invoices(patient_id, portal_visible, hide_amounts_from_patient, status);

CREATE INDEX IF NOT EXISTS idx_invoices_payer_relation
    ON invoices(payer_patient_relation_id)
    WHERE payer_patient_relation_id IS NOT NULL;
