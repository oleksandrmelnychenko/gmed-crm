CREATE TABLE document_translation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id),
    requested_language TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    requested_by UUID NOT NULL REFERENCES users(id),
    note TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_translation_requests_document
    ON document_translation_requests(document_id, requested_at DESC);

CREATE INDEX idx_document_translation_requests_patient
    ON document_translation_requests(patient_id, status);

CREATE UNIQUE INDEX idx_document_translation_requests_active
    ON document_translation_requests(document_id, requested_language)
    WHERE status IN ('pending', 'in_progress');

CREATE TRIGGER set_updated_at_document_translation_requests
    BEFORE UPDATE ON document_translation_requests
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
