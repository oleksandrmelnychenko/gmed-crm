-- Which documents a paid invoice marked as reimbursed, and what they said
-- before (QA 2026-10-31). The mark had no way back: a reversed payment left the
-- document reimbursed, with a payment date and method it never had. The rows
-- let the mark be undone exactly, in the transaction that un-pays the invoice.
-- Documents marked before this migration have no row and stay as they are.

CREATE TABLE IF NOT EXISTS invoice_document_reimbursements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    previous_financial_status TEXT,
    previous_payment_date DATE,
    previous_payment_method TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    undone_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invoice_document_reimbursements_active
    ON invoice_document_reimbursements(invoice_id)
    WHERE undone_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_document_reimbursements_document
    ON invoice_document_reimbursements(document_id);

COMMENT ON TABLE invoice_document_reimbursements IS
    'Documents a paid invoice set to reimbursed, with their previous financial status, payment date and method; undone_at is set when the invoice stops being paid.';
