-- Issued invoice documents are rendered once and kept unchanged (GoBD). The
-- sealed PDF lives with the uploaded documents; this table records it with a
-- checksum of the plaintext. Dunning letters are stored the same way.
CREATE TABLE invoice_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    document_kind TEXT NOT NULL
        CHECK (document_kind IN ('invoice', 'dunning_letter')),
    dunning_event_id UUID REFERENCES invoice_dunning_events(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    document_language TEXT NOT NULL,
    -- `release`: rendered when the invoice was released; `first_download`:
    -- an invoice released before stored documents existed, kept from its
    -- first download on; `dunning`: a dunning letter.
    generation_trigger TEXT NOT NULL
        CHECK (generation_trigger IN ('release', 'first_download', 'dunning')),
    generated_by UUID REFERENCES users(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_documents_kind_shape CHECK (
        (document_kind = 'invoice' AND dunning_event_id IS NULL)
        OR (document_kind = 'dunning_letter' AND dunning_event_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_invoice_documents_invoice
    ON invoice_documents(invoice_id)
    WHERE document_kind = 'invoice';

CREATE UNIQUE INDEX uq_invoice_documents_dunning_event
    ON invoice_documents(dunning_event_id)
    WHERE dunning_event_id IS NOT NULL;

CREATE INDEX idx_invoice_documents_invoice
    ON invoice_documents(invoice_id, generated_at);

-- A stored document is never rewritten; key rotation re-seals the blob on
-- disk, not the row.
CREATE OR REPLACE FUNCTION invoice_documents_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Stored invoice documents cannot be changed'
        USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER invoice_documents_immutable
    BEFORE UPDATE ON invoice_documents
    FOR EACH ROW
    EXECUTE FUNCTION invoice_documents_immutable();
