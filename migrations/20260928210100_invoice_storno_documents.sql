-- Cancelling a released invoice issues a cancellation document
-- (Stornorechnung, GoBD): its own number from the `invoice_storno` range, the
-- original invoice's number and date, and every invoice line with negative
-- amounts, summed per VAT rate. A released invoice stays final; the pair
-- invoice + cancellation document nets to zero in the patient's account.
-- Drafts cancelled before release were never issued and get no document.

CREATE TABLE invoice_storno_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
    document_number TEXT NOT NULL UNIQUE CHECK (length(btrim(document_number)) > 0),
    issued_on DATE NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    original_invoice_number TEXT NOT NULL,
    original_invoice_date DATE NOT NULL,
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_net NUMERIC(12, 2) NOT NULL CHECK (amount_net <= 0),
    amount_vat NUMERIC(12, 2) NOT NULL CHECK (amount_vat <= 0),
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross <= 0),
    -- Cancelled invoice lines with negative amounts: invoice_line_index,
    -- description, quantity, unit_price, vat_rate, is_cost_passthrough,
    -- line_net, line_vat, line_gross.
    line_items JSONB NOT NULL CHECK (jsonb_typeof(line_items) = 'array'),
    -- Negative net, VAT and gross per VAT rate.
    vat_breakdown JSONB NOT NULL CHECK (jsonb_typeof(vat_breakdown) = 'array'),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_storno_amount_consistency
        CHECK (round(amount_net + amount_vat, 2) = amount_gross),
    CONSTRAINT invoice_storno_not_before_invoice
        CHECK (issued_on >= original_invoice_date)
);

CREATE INDEX idx_invoice_storno_documents_issued_on
    ON invoice_storno_documents(issued_on, created_at);

-- A cancellation document belongs to a released invoice that is being (or
-- was) cancelled and reverses exactly its totals.
CREATE OR REPLACE FUNCTION validate_invoice_storno_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    invoice_row invoices%ROWTYPE;
BEGIN
    SELECT * INTO invoice_row
    FROM invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invoice for cancellation document does not exist'
            USING ERRCODE = 'P0001';
    END IF;
    IF invoice_row.released_at IS NULL OR invoice_row.status <> 'cancelled' THEN
        RAISE EXCEPTION 'a cancellation document belongs to a released, cancelled invoice'
            USING ERRCODE = 'P0001';
    END IF;
    IF NEW.original_invoice_number IS DISTINCT FROM invoice_row.invoice_number THEN
        RAISE EXCEPTION 'cancellation document must name the original invoice number'
            USING ERRCODE = 'P0001';
    END IF;
    IF NEW.currency <> invoice_row.currency THEN
        RAISE EXCEPTION 'cancellation document currency must match the invoice currency'
            USING ERRCODE = 'P0001';
    END IF;
    IF NEW.amount_gross <> -invoice_row.total_gross
        OR NEW.amount_net <> -invoice_row.total_net
        OR NEW.amount_vat <> -invoice_row.total_vat
    THEN
        RAISE EXCEPTION 'cancellation document must reverse the invoice totals'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_invoice_storno_document_trigger
    BEFORE INSERT ON invoice_storno_documents
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_storno_document();

CREATE OR REPLACE FUNCTION protect_invoice_storno_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'cancellation documents are final and cannot be changed'
        USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER protect_invoice_storno_document_trigger
    BEFORE UPDATE OR DELETE ON invoice_storno_documents
    FOR EACH ROW
    EXECUTE FUNCTION protect_invoice_storno_document();
