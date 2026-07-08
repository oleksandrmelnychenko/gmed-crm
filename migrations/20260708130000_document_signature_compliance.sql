-- Link a signed document to the compliance requirement it satisfies (#13).
-- Until now "upload a signed file" and "flip a compliance flag" were two
-- unrelated manual steps with no evidence trail. These additive columns let a
-- single atomic action record the signature and which requirement it proves.
ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS compliance_kind TEXT
        CHECK (
            compliance_kind IS NULL
            OR compliance_kind IN (
                'dsgvo',
                'confidentiality_release',
                'identity',
                'framework_contract',
                'other'
            )
        );

CREATE INDEX IF NOT EXISTS idx_documents_compliance_kind
    ON documents (patient_id, compliance_kind)
    WHERE compliance_kind IS NOT NULL;
