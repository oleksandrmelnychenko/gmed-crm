-- QA 2026-11-16 (verify-A).
--
-- S1-1: every payment on an advance freezes its VAT split when it is
-- recorded. A split set by hand (`manual`) adds up to the payment; a pro rata
-- split computed by the server covers at most the payment (the rest of an
-- overpayment is patient credit). Splits written before are set by hand.
-- Payments recorded before keep the former reading until the next payment
-- on the same advance freezes them (the server computes them with the same
-- code that reads them today, so nothing booked or deducted moves).
ALTER TABLE invoice_payment_category_splits
    ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION validate_invoice_payment_category_split()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment invoice_payment_transactions%ROWTYPE;
    rows_gross NUMERIC;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Payment category splits are append-only';
    END IF;
    SELECT * INTO payment FROM invoice_payment_transactions
    WHERE id = NEW.payment_transaction_id;
    IF payment.id IS NULL OR payment.transaction_type <> 'payment'
       OR payment.invoice_id <> NEW.invoice_id THEN
        RAISE EXCEPTION 'A category split belongs to a payment of the same invoice';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND invoice_type = 'advance') THEN
        RAISE EXCEPTION 'A category split is set only on payments of an advance invoice';
    END IF;
    SELECT COALESCE(SUM((row_value ->> 'gross')::NUMERIC), 0) INTO rows_gross
    FROM jsonb_array_elements(NEW.rows) AS row_value;
    IF (NEW.manual AND rows_gross <> payment.amount_gross)
       OR (NOT NEW.manual AND rows_gross > payment.amount_gross)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.rows) AS row_value
                  WHERE (row_value ->> 'gross')::NUMERIC < 0
                     OR COALESCE((row_value ->> 'vat')::NUMERIC, 0) < 0) THEN
        RAISE EXCEPTION 'The category split must add up to the payment amount';
    END IF;
    RETURN NEW;
END;
$$;

-- S2-3: the cancellation document of a final invoice states the advances the
-- final deducted (they are released by the Storno), so its PDF mirrors what
-- the final asked. NULL for documents issued before (and without deductions).
ALTER TABLE invoice_storno_documents
    ADD COLUMN IF NOT EXISTS deducted_advances JSONB
        CHECK (deducted_advances IS NULL OR jsonb_typeof(deducted_advances) = 'array');
