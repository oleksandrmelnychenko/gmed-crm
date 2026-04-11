ALTER TABLE documents
    ADD COLUMN version_root_document_id UUID REFERENCES documents(id),
    ADD COLUMN replaces_document_id UUID REFERENCES documents(id),
    ADD COLUMN version_number INT NOT NULL DEFAULT 1;

UPDATE documents
SET version_root_document_id = id
WHERE version_root_document_id IS NULL;

ALTER TABLE documents
    ALTER COLUMN version_root_document_id SET NOT NULL;

CREATE INDEX idx_documents_version_root
    ON documents(version_root_document_id, version_number DESC, created_at DESC);

CREATE UNIQUE INDEX idx_documents_replaces_unique
    ON documents(replaces_document_id)
    WHERE replaces_document_id IS NOT NULL;
