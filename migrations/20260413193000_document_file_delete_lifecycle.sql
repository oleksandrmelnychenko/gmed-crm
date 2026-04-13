ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS file_deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS file_deleted_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS file_delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_file_deleted_at
    ON documents(file_deleted_at)
    WHERE file_deleted_at IS NOT NULL;
