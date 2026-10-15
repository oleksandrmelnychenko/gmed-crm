-- An explicit staff choice, preserved with the durable signature outbox.
-- Existing paper records and scans remain immutable source evidence.
ALTER TABLE document_signature_requests
    ADD COLUMN paper_signed_document_ids UUID[] NOT NULL DEFAULT '{}';
