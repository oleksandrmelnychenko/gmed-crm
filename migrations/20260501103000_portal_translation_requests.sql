ALTER TABLE document_translation_requests
    ADD COLUMN IF NOT EXISTS request_source TEXT NOT NULL DEFAULT 'staff'
        CHECK (request_source IN ('staff', 'patient_portal'));

CREATE INDEX IF NOT EXISTS idx_document_translation_requests_source_status
    ON document_translation_requests(request_source, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_translation_requests_patient_portal
    ON document_translation_requests(patient_id, requested_by, requested_at DESC)
    WHERE request_source = 'patient_portal';
