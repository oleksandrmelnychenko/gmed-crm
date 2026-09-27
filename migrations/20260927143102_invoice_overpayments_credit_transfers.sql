-- Overpayments and patient credit transfers.
--
-- A bank receipt larger than the open balance of an invoice could not be
-- recorded: the payment journal refused it, so billing could not book money
-- the patient actually sent. A receipt above the open balance is now recorded
-- in full; the excess stays on the invoice as the patient's credit balance
-- (booked as `patient_credit`, not revenue) until it is refunded through the
-- refund journal or moved to another open invoice of the same patient.
--
-- A credit transfer moves such a credit balance: it is a refund leg on the
-- source invoice and a payment leg on the target invoice, both with the
-- payment method `credit_transfer`, recorded atomically and linked in
-- `invoice_credit_transfers`. The legs are reversed together only.

CREATE OR REPLACE FUNCTION validate_invoice_payment_transaction()
RETURNS trigger AS $$
DECLARE
    invoice_row invoices%ROWTYPE;
    original invoice_payment_transactions%ROWTYPE;
    current_cash_paid NUMERIC(12, 2);
    current_cash_refunded NUMERIC(12, 2);
BEGIN
    SELECT * INTO invoice_row
    FROM invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice for payment transaction does not exist';
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO current_cash_paid
    FROM invoice_payment_transactions
    WHERE invoice_id = NEW.invoice_id;

    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'refund' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO current_cash_refunded
    FROM invoice_refund_transactions
    WHERE invoice_id = NEW.invoice_id;

    IF NEW.transaction_type = 'payment' THEN
        IF invoice_row.status IN ('draft', 'cancelled') THEN
            RAISE EXCEPTION 'Payments require an active released invoice';
        END IF;
        -- Cash above the adjusted balance is an overpayment and becomes the
        -- patient's credit balance on this invoice.
        RETURN NEW;
    END IF;

    SELECT * INTO original
    FROM invoice_payment_transactions
    WHERE id = NEW.reverses_transaction_id
    FOR UPDATE;

    IF NOT FOUND
        OR original.invoice_id <> NEW.invoice_id
        OR original.transaction_type <> 'payment'
    THEN
        RAISE EXCEPTION 'Reversal must reference a payment on the same invoice';
    END IF;
    IF NEW.amount_gross <> original.amount_gross THEN
        RAISE EXCEPTION 'Reversal amount must match the original payment';
    END IF;
    IF EXISTS (
        SELECT 1 FROM invoice_payment_transactions reversal
        WHERE reversal.reverses_transaction_id = original.id
          AND reversal.transaction_type = 'reversal'
    ) THEN
        RAISE EXCEPTION 'Payment was already reversed';
    END IF;
    IF current_cash_paid - original.amount_gross < current_cash_refunded THEN
        RAISE EXCEPTION 'Payment cannot be reversed after its cash was refunded';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE invoice_payment_transactions
    DROP CONSTRAINT IF EXISTS invoice_payment_transactions_payment_method_check;
ALTER TABLE invoice_payment_transactions
    ADD CONSTRAINT invoice_payment_transactions_payment_method_check CHECK (
        payment_method IN (
            'bank_transfer',
            'card',
            'cash',
            'direct_debit',
            'cheque',
            'other',
            'legacy_import',
            'credit_transfer'
        )
    );

ALTER TABLE invoice_refund_transactions
    DROP CONSTRAINT IF EXISTS invoice_refund_transactions_payment_method_check;
ALTER TABLE invoice_refund_transactions
    ADD CONSTRAINT invoice_refund_transactions_payment_method_check CHECK (
        payment_method IN (
            'bank_transfer',
            'card',
            'cash',
            'direct_debit',
            'cheque',
            'other',
            'credit_transfer'
        )
    );

CREATE TABLE invoice_credit_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL,
    source_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    target_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    transferred_on DATE NOT NULL,
    source_refund_transaction_id UUID NOT NULL UNIQUE
        REFERENCES invoice_refund_transactions(id) ON DELETE RESTRICT,
    target_payment_transaction_id UUID NOT NULL UNIQUE
        REFERENCES invoice_payment_transactions(id) ON DELETE RESTRICT,
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_credit_transfer_distinct_invoices
        CHECK (source_invoice_id <> target_invoice_id),
    CONSTRAINT invoice_credit_transfer_request UNIQUE (source_invoice_id, request_id)
);

CREATE INDEX idx_invoice_credit_transfers_source
    ON invoice_credit_transfers(source_invoice_id, created_at DESC);
CREATE INDEX idx_invoice_credit_transfers_target
    ON invoice_credit_transfers(target_invoice_id, created_at DESC);

COMMENT ON TABLE invoice_credit_transfers IS
    'Append-only moves of a patient credit balance (overpayment or unrefunded credit note) from one invoice to another open invoice of the same patient: a credit_transfer refund leg on the source and a credit_transfer payment leg on the target.';

CREATE OR REPLACE FUNCTION validate_invoice_credit_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_row invoices%ROWTYPE;
    target_row invoices%ROWTYPE;
    refund_leg invoice_refund_transactions%ROWTYPE;
    payment_leg invoice_payment_transactions%ROWTYPE;
BEGIN
    SELECT * INTO source_row FROM invoices WHERE id = NEW.source_invoice_id;
    SELECT * INTO target_row FROM invoices WHERE id = NEW.target_invoice_id;
    IF source_row.id IS NULL OR target_row.id IS NULL THEN
        RAISE EXCEPTION 'credit transfer invoices do not exist';
    END IF;
    IF source_row.patient_id <> target_row.patient_id
        OR UPPER(source_row.currency) <> UPPER(target_row.currency)
        OR UPPER(NEW.currency) <> UPPER(source_row.currency)
    THEN
        RAISE EXCEPTION 'credit transfers stay within one patient and currency';
    END IF;
    IF target_row.status IN ('draft', 'cancelled') OR source_row.status IN ('draft', 'cancelled') THEN
        RAISE EXCEPTION 'credit transfers require released invoices';
    END IF;

    SELECT * INTO refund_leg
    FROM invoice_refund_transactions
    WHERE id = NEW.source_refund_transaction_id;
    SELECT * INTO payment_leg
    FROM invoice_payment_transactions
    WHERE id = NEW.target_payment_transaction_id;
    IF refund_leg.id IS NULL
        OR refund_leg.invoice_id <> NEW.source_invoice_id
        OR refund_leg.transaction_type <> 'refund'
        OR refund_leg.payment_method <> 'credit_transfer'
        OR refund_leg.amount_gross <> NEW.amount_gross
        OR payment_leg.id IS NULL
        OR payment_leg.invoice_id <> NEW.target_invoice_id
        OR payment_leg.transaction_type <> 'payment'
        OR payment_leg.payment_method <> 'credit_transfer'
        OR payment_leg.amount_gross <> NEW.amount_gross
    THEN
        RAISE EXCEPTION 'credit transfer legs must match the transfer';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_invoice_credit_transfer_trigger
    BEFORE INSERT ON invoice_credit_transfers
    FOR EACH ROW EXECUTE FUNCTION validate_invoice_credit_transfer();

CREATE OR REPLACE FUNCTION protect_invoice_credit_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'credit transfers are append-only; reverse the transfer instead';
END;
$$;

CREATE TRIGGER protect_invoice_credit_transfer_trigger
    BEFORE UPDATE OR DELETE ON invoice_credit_transfers
    FOR EACH ROW EXECUTE FUNCTION protect_invoice_credit_transfer();

-- A transfer leg is reversed only together with its counterpart, checked at
-- commit so both reversal rows can be written in one transaction.
CREATE OR REPLACE FUNCTION validate_credit_transfer_leg_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    transfer invoice_credit_transfers%ROWTYPE;
BEGIN
    IF NEW.transaction_type <> 'reversal' THEN
        RETURN NULL;
    END IF;
    IF TG_TABLE_NAME = 'invoice_payment_transactions' THEN
        SELECT * INTO transfer
        FROM invoice_credit_transfers
        WHERE target_payment_transaction_id = NEW.reverses_transaction_id;
    ELSE
        SELECT * INTO transfer
        FROM invoice_credit_transfers
        WHERE source_refund_transaction_id = NEW.reverses_transaction_id;
    END IF;
    IF transfer.id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
            SELECT 1 FROM invoice_payment_transactions reversal
            WHERE reversal.reverses_transaction_id = transfer.target_payment_transaction_id
              AND reversal.transaction_type = 'reversal'
        )
        OR NOT EXISTS (
            SELECT 1 FROM invoice_refund_transactions reversal
            WHERE reversal.reverses_transaction_id = transfer.source_refund_transaction_id
              AND reversal.transaction_type = 'reversal'
        )
    THEN
        RAISE EXCEPTION 'a credit transfer is reversed only as a whole';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_credit_transfer_payment_leg_reversal
    AFTER INSERT ON invoice_payment_transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_credit_transfer_leg_reversal();

CREATE CONSTRAINT TRIGGER validate_credit_transfer_refund_leg_reversal
    AFTER INSERT ON invoice_refund_transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_credit_transfer_leg_reversal();
