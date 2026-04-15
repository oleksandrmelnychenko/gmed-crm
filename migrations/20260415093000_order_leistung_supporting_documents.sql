ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS external_document_id UUID REFERENCES documents(id);

CREATE INDEX IF NOT EXISTS idx_ol_external_document_id
    ON order_leistungen(external_document_id)
    WHERE external_document_id IS NOT NULL;
