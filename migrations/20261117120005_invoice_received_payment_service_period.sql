-- Money that arrived before the invoice (owner 2026-11-17): staff note on the
-- draft when and how much was received; the release records it as a payment
-- with that receipt date in the same transaction and the issued invoice states
-- it. The service period staff set on an invoice replaces the one read from
-- its lines and its order. Both are part of the issued document (GoBD): they
-- never change after the release.

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS payment_received_on DATE,
    ADD COLUMN IF NOT EXISTS payment_received_amount NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS payment_received_method TEXT,
    ADD COLUMN IF NOT EXISTS payment_received_transaction_id UUID
        REFERENCES invoice_payment_transactions(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS service_period_from DATE,
    ADD COLUMN IF NOT EXISTS service_period_to DATE;

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_payment_received_shape;
ALTER TABLE invoices
    ADD CONSTRAINT invoices_payment_received_shape CHECK (
        (payment_received_on IS NULL
         AND payment_received_amount IS NULL
         AND payment_received_method IS NULL
         AND payment_received_transaction_id IS NULL)
        OR (payment_received_on IS NOT NULL
            AND payment_received_amount > 0
            AND payment_received_method IN (
                'bank_transfer', 'card', 'cash', 'direct_debit', 'cheque', 'other'
            ))
    );

-- Only the end known: printed as «bis MM.YYYY».
ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_service_period_shape;
ALTER TABLE invoices
    ADD CONSTRAINT invoices_service_period_shape CHECK (
        (service_period_from IS NULL AND service_period_to IS NULL)
        OR (service_period_to IS NOT NULL
            AND (service_period_from IS NULL OR service_period_from <= service_period_to))
    );

COMMENT ON COLUMN invoices.payment_received_on IS
    'Day the money arrived before the invoice was issued; recorded as a payment at the release and printed on the invoice.';
COMMENT ON COLUMN invoices.payment_received_transaction_id IS
    'The payment the release recorded from payment_received_*.';
COMMENT ON COLUMN invoices.service_period_from IS
    'Service period set by staff; without a start only the month of service_period_to is printed («bis MM.YYYY»).';

CREATE OR REPLACE FUNCTION invoices_issued_terms_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.released_at IS NOT NULL AND (
        NEW.payment_received_on IS DISTINCT FROM OLD.payment_received_on
        OR NEW.payment_received_amount IS DISTINCT FROM OLD.payment_received_amount
        OR NEW.payment_received_method IS DISTINCT FROM OLD.payment_received_method
        OR NEW.service_period_from IS DISTINCT FROM OLD.service_period_from
        OR NEW.service_period_to IS DISTINCT FROM OLD.service_period_to
        OR (OLD.payment_received_transaction_id IS NOT NULL
            AND NEW.payment_received_transaction_id IS DISTINCT FROM OLD.payment_received_transaction_id)
    ) THEN
        RAISE EXCEPTION 'The received payment and the service period of an issued invoice cannot change'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_issued_terms_guard ON invoices;
CREATE TRIGGER invoices_issued_terms_guard
    BEFORE UPDATE OF payment_received_on, payment_received_amount, payment_received_method,
        payment_received_transaction_id, service_period_from, service_period_to
    ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION invoices_issued_terms_guard();
