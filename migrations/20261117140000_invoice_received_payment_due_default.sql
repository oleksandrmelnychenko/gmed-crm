-- «Оплата уже поступила» without a typed amount (QA verify2 B-2): the money
-- received is what the invoice leaves to pay at its release, after the
-- advances the release credits — not the gross total. The draft stores the
-- amount as NULL and the release resolves it once, in the release
-- transaction, before the payment is recorded and the document rendered.
-- When nothing is left to pay the release drops the note (no payment).

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_payment_received_shape;
ALTER TABLE invoices
    ADD CONSTRAINT invoices_payment_received_shape CHECK (
        (payment_received_on IS NULL
         AND payment_received_amount IS NULL
         AND payment_received_method IS NULL
         AND payment_received_transaction_id IS NULL)
        OR (payment_received_on IS NOT NULL
            AND (payment_received_amount IS NULL OR payment_received_amount > 0)
            AND (payment_received_amount IS NOT NULL OR payment_received_transaction_id IS NULL)
            AND payment_received_method IN (
                'bank_transfer', 'card', 'cash', 'direct_debit', 'cheque', 'other'
            ))
    );

COMMENT ON COLUMN invoices.payment_received_amount IS
    'Gross received before the invoice; NULL on a draft = what is left to pay at the release (resolved by the release).';

CREATE OR REPLACE FUNCTION invoices_issued_terms_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    -- The release resolves an amount left open on the draft once: it sets
    -- the amount (or drops the note when nothing is due) before the payment
    -- is recorded.
    resolving BOOLEAN := OLD.payment_received_amount IS NULL
        AND OLD.payment_received_transaction_id IS NULL
        AND OLD.payment_received_on IS NOT NULL;
BEGIN
    IF OLD.released_at IS NOT NULL AND (
        (NOT resolving AND (
            NEW.payment_received_on IS DISTINCT FROM OLD.payment_received_on
            OR NEW.payment_received_amount IS DISTINCT FROM OLD.payment_received_amount
            OR NEW.payment_received_method IS DISTINCT FROM OLD.payment_received_method))
        OR (resolving AND NEW.payment_received_on IS NOT NULL AND (
            NEW.payment_received_on IS DISTINCT FROM OLD.payment_received_on
            OR NEW.payment_received_method IS DISTINCT FROM OLD.payment_received_method))
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
