ALTER TABLE documents
    ADD COLUMN extracted_text TEXT,
    ADD COLUMN text_extraction_status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (text_extraction_status IN ('not_started', 'completed', 'unsupported', 'failed')),
    ADD COLUMN text_extraction_method TEXT,
    ADD COLUMN text_extracted_at TIMESTAMPTZ,
    ADD COLUMN text_extracted_by UUID REFERENCES users(id);

ALTER TABLE document_translation_requests
    ADD COLUMN source_language TEXT,
    ADD COLUMN source_text TEXT,
    ADD COLUMN translated_text TEXT,
    ADD COLUMN translated_by UUID REFERENCES users(id),
    ADD COLUMN translated_at TIMESTAMPTZ;
