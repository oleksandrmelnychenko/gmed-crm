-- Credit notes, their reversals and cancellation documents are archived like
-- invoices (GoBD): the PDF is rendered once when the document is issued and
-- every later download serves that stored copy. Credit notes issued before
-- this change get their copy on the first download (`first_download`).

ALTER TABLE invoice_documents
    ADD COLUMN IF NOT EXISTS credit_note_transaction_id UUID
        REFERENCES invoice_credit_note_transactions(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS storno_document_id UUID
        REFERENCES invoice_storno_documents(id) ON DELETE RESTRICT;

ALTER TABLE invoice_documents
    DROP CONSTRAINT IF EXISTS invoice_documents_document_kind_check;
ALTER TABLE invoice_documents
    ADD CONSTRAINT invoice_documents_document_kind_check
    CHECK (document_kind IN ('invoice', 'dunning_letter', 'credit_note', 'storno'));

-- `issue`: rendered when the credit note, reversal or cancellation document
-- was issued.
ALTER TABLE invoice_documents
    DROP CONSTRAINT IF EXISTS invoice_documents_generation_trigger_check;
ALTER TABLE invoice_documents
    ADD CONSTRAINT invoice_documents_generation_trigger_check
    CHECK (generation_trigger IN ('release', 'first_download', 'dunning', 'issue'));

ALTER TABLE invoice_documents
    DROP CONSTRAINT IF EXISTS invoice_documents_kind_shape;
ALTER TABLE invoice_documents
    ADD CONSTRAINT invoice_documents_kind_shape CHECK (
        (document_kind = 'invoice'
            AND dunning_event_id IS NULL
            AND credit_note_transaction_id IS NULL
            AND storno_document_id IS NULL)
        OR (document_kind = 'dunning_letter'
            AND dunning_event_id IS NOT NULL
            AND credit_note_transaction_id IS NULL
            AND storno_document_id IS NULL)
        OR (document_kind = 'credit_note'
            AND dunning_event_id IS NULL
            AND credit_note_transaction_id IS NOT NULL
            AND storno_document_id IS NULL)
        OR (document_kind = 'storno'
            AND dunning_event_id IS NULL
            AND credit_note_transaction_id IS NULL
            AND storno_document_id IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_documents_credit_note
    ON invoice_documents(credit_note_transaction_id)
    WHERE credit_note_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_documents_storno
    ON invoice_documents(storno_document_id)
    WHERE storno_document_id IS NOT NULL;
