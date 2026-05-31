ALTER TABLE interpreter_compliance_profiles
    ADD COLUMN IF NOT EXISTS confidentiality_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS avv_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE interpreter_credentials
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS interpreter_profile_documents (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    interpreter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_kind TEXT NOT NULL
        CHECK (document_kind IN ('credential', 'confidentiality', 'avv', 'gdpr_training', 'work_permit', 'other')),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreter_profile_documents_interpreter
    ON interpreter_profile_documents(interpreter_id, document_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interpreter_credentials_document
    ON interpreter_credentials(document_id)
    WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interpreter_compliance_confidentiality_document
    ON interpreter_compliance_profiles(confidentiality_document_id)
    WHERE confidentiality_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interpreter_compliance_avv_document
    ON interpreter_compliance_profiles(avv_document_id)
    WHERE avv_document_id IS NOT NULL;
