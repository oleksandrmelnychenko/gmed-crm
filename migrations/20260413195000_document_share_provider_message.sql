ALTER TABLE document_shares
    ADD COLUMN IF NOT EXISTS message TEXT;
