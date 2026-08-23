CREATE TABLE IF NOT EXISTS provider_document_links (
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    linked_by UUID NOT NULL REFERENCES users(id),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_document_links_document
    ON provider_document_links (document_id, provider_id);

CREATE INDEX IF NOT EXISTS idx_documents_patient_medical_created
    ON documents (patient_id, is_medical, created_at DESC)
    WHERE patient_id IS NOT NULL AND file_deleted_at IS NULL;

