-- Internal staff notes on quotes and invoices (owner 2026-10-12).
--
-- `notes` of a quote or an invoice is the customer remark: it is printed on
-- the cost estimate and the invoice ("Hinweise") and copied from the quote
-- into its invoices. `internal_note` is for staff only: never printed, never
-- copied into another document, never given to the patient portal or to a
-- payer. It is not part of the issued (GoBD) document, so it stays editable
-- after an invoice is released or cancelled; every change is audited
-- (`update_invoice_internal_note` / `update_quote_internal_note`).
ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS internal_note TEXT;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS internal_note TEXT;

ALTER TABLE quotes
    DROP CONSTRAINT IF EXISTS quotes_internal_note_length,
    ADD CONSTRAINT quotes_internal_note_length
        CHECK (internal_note IS NULL OR char_length(internal_note) BETWEEN 1 AND 4000);

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_internal_note_length,
    ADD CONSTRAINT invoices_internal_note_length
        CHECK (internal_note IS NULL OR char_length(internal_note) BETWEEN 1 AND 4000);

COMMENT ON COLUMN quotes.notes IS
    'Customer remark printed on the cost estimate and copied into its invoices.';
COMMENT ON COLUMN quotes.internal_note IS
    'Staff-only note: never printed, never copied into invoices, never shown to the patient or a payer.';
COMMENT ON COLUMN invoices.notes IS
    'Customer remark printed on the invoice ("Hinweise").';
COMMENT ON COLUMN invoices.internal_note IS
    'Staff-only note: never printed, not part of the issued document (editable after release), never shown in the patient portal or to a payer.';
