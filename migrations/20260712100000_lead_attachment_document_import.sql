ALTER TABLE lead_attachments
    ADD COLUMN IF NOT EXISTS imported_document_id UUID,
    ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

DO $$
BEGIN
    ALTER TABLE lead_attachments
        ADD CONSTRAINT fk_lead_attachments_imported_document
        FOREIGN KEY (imported_document_id)
        REFERENCES documents(id)
        ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_attachments_imported_document
    ON lead_attachments (imported_document_id)
    WHERE imported_document_id IS NOT NULL;
