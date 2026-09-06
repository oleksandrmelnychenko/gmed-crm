CREATE INDEX document_signature_source_history
    ON document_signature_requests(source_document_id, created_at DESC, id DESC);
CREATE INDEX document_signature_result_history
    ON document_signature_requests(result_document_id, created_at DESC, id DESC)
    WHERE result_document_id IS NOT NULL;
