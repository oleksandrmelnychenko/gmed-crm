-- The guard of migration 20260819143000 counted payments only, the application
-- counts payments minus refunds: an invoice whose cash went back (a refund, or
-- the refund leg of a credit transfer) passed the application's check and then
-- failed in this trigger, a 500 instead of the cancellation (QA 2026-10-31).

CREATE OR REPLACE FUNCTION validate_invoice_cancellation_financials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    net_cash NUMERIC(12, 2);
BEGIN
    IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
        SELECT COALESCE((
            SELECT SUM(
                CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
            )
            FROM invoice_payment_transactions
            WHERE invoice_id = OLD.id
        ), 0) - COALESCE((
            SELECT SUM(
                CASE WHEN transaction_type = 'refund' THEN amount_gross ELSE -amount_gross END
            )
            FROM invoice_refund_transactions
            WHERE invoice_id = OLD.id
        ), 0)
        INTO net_cash;

        IF net_cash <> 0 OR OLD.prepayment_applied_amount <> 0 THEN
            RAISE EXCEPTION 'payments and prepayments must be reversed or released before cancellation';
        END IF;
        IF OLD.credited_amount <> 0 THEN
            RAISE EXCEPTION 'credit notes must be reversed before cancellation';
        END IF;
        IF OLD.invoice_type = 'advance' AND EXISTS (
            SELECT 1
            FROM invoice_prepayment_allocations allocation
            WHERE allocation.advance_invoice_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'applied advance payment must be released before cancellation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
