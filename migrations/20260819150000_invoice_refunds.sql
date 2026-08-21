-- Cash refunds are distinct from payment reversals: a reversal corrects an
-- incorrectly recorded receipt, while a refund records money actually returned
-- after a legal credit note created a patient credit balance.

CREATE TABLE invoice_refund_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL
        CHECK (transaction_type IN ('refund', 'reversal')),
    request_id UUID,
    reverses_transaction_id UUID
        REFERENCES invoice_refund_transactions(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    payment_method TEXT NOT NULL CHECK (
        payment_method IN (
            'bank_transfer',
            'card',
            'cash',
            'direct_debit',
            'cheque',
            'other'
        )
    ),
    payment_reference TEXT,
    refunded_on DATE NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_refund_transaction_shape CHECK (
        (
            transaction_type = 'refund'
            AND request_id IS NOT NULL
            AND reverses_transaction_id IS NULL
        )
        OR
        (
            transaction_type = 'reversal'
            AND request_id IS NULL
            AND reverses_transaction_id IS NOT NULL
        )
    )
);

CREATE INDEX idx_invoice_refund_transactions_invoice
    ON invoice_refund_transactions(invoice_id, refunded_on DESC, created_at DESC);

CREATE UNIQUE INDEX uq_invoice_refund_transaction_request
    ON invoice_refund_transactions(invoice_id, request_id)
    WHERE transaction_type = 'refund';

CREATE UNIQUE INDEX uq_invoice_refund_transaction_reversal
    ON invoice_refund_transactions(reverses_transaction_id)
    WHERE transaction_type = 'reversal';

CREATE OR REPLACE FUNCTION validate_invoice_refund_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    invoice_row invoices%ROWTYPE;
    original invoice_refund_transactions%ROWTYPE;
    cash_received NUMERIC(12, 2);
    already_refunded NUMERIC(12, 2);
    required_cash NUMERIC(12, 2);
    available_refund NUMERIC(12, 2);
    latest_balance_date DATE;
BEGIN
    SELECT *
    INTO invoice_row
    FROM invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice for refund transaction does not exist';
    END IF;

    IF NEW.transaction_type = 'reversal' THEN
        SELECT *
        INTO original
        FROM invoice_refund_transactions
        WHERE id = NEW.reverses_transaction_id
        FOR UPDATE;

        IF NOT FOUND
            OR original.invoice_id <> NEW.invoice_id
            OR original.transaction_type <> 'refund'
        THEN
            RAISE EXCEPTION 'Refund reversal must reference a refund on the same invoice';
        END IF;
        IF NEW.amount_gross <> original.amount_gross
            OR NEW.payment_method <> original.payment_method
            OR NEW.payment_reference IS DISTINCT FROM original.payment_reference
        THEN
            RAISE EXCEPTION 'Refund reversal must match the original refund';
        END IF;
        IF NEW.refunded_on < original.refunded_on THEN
            RAISE EXCEPTION 'Refund reversal date cannot precede the original refund';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM invoice_refund_transactions reversal
            WHERE reversal.reverses_transaction_id = original.id
              AND reversal.transaction_type = 'reversal'
        ) THEN
            RAISE EXCEPTION 'Refund was already reversed';
        END IF;
        RETURN NEW;
    END IF;

    IF invoice_row.status IN ('draft', 'cancelled') THEN
        RAISE EXCEPTION 'Refunds require an active released invoice';
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO cash_received
    FROM invoice_payment_transactions
    WHERE invoice_id = NEW.invoice_id;

    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'refund' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO already_refunded
    FROM invoice_refund_transactions
    WHERE invoice_id = NEW.invoice_id;

    required_cash := GREATEST(
        invoice_row.total_gross
            - invoice_row.credited_amount
            - invoice_row.prepayment_applied_amount,
        0
    );
    available_refund := GREATEST(cash_received - already_refunded - required_cash, 0);
    IF NEW.amount_gross > available_refund THEN
        RAISE EXCEPTION 'Refund exceeds the refundable cash credit';
    END IF;

    SELECT GREATEST(
        invoice_row.issued_at::date,
        COALESCE((
            SELECT MAX(payment.received_on)
            FROM invoice_payment_transactions payment
            WHERE payment.invoice_id = NEW.invoice_id
        ), invoice_row.issued_at::date),
        COALESCE((
            SELECT MAX(credit.issued_on)
            FROM invoice_credit_note_transactions credit
            WHERE credit.invoice_id = NEW.invoice_id
        ), invoice_row.issued_at::date),
        COALESCE((
            SELECT MAX(allocation.created_at::date)
            FROM invoice_prepayment_allocations allocation
            WHERE allocation.target_invoice_id = NEW.invoice_id
        ), invoice_row.issued_at::date),
        COALESCE((
            SELECT MAX(refund.refunded_on)
            FROM invoice_refund_transactions refund
            WHERE refund.invoice_id = NEW.invoice_id
        ), invoice_row.issued_at::date)
    )
    INTO latest_balance_date;

    IF NEW.refunded_on < latest_balance_date THEN
        RAISE EXCEPTION 'Refund date cannot precede the latest balance movement';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_invoice_refund_transaction_trigger
    BEFORE INSERT ON invoice_refund_transactions
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_refund_transaction();

CREATE OR REPLACE FUNCTION protect_invoice_refund_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Invoice refund transactions are append-only; create a reversal instead';
END;
$$;

CREATE TRIGGER protect_invoice_refund_transaction_trigger
    BEFORE UPDATE OR DELETE ON invoice_refund_transactions
    FOR EACH ROW
    EXECUTE FUNCTION protect_invoice_refund_transaction();

-- New payments are capped against cash retained after refunds. A payment cannot
-- be reversed when part of that receipt has already been returned to the patient.
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
        IF current_cash_paid + NEW.amount_gross - current_cash_refunded
                + invoice_row.prepayment_applied_amount
            > invoice_row.total_gross - invoice_row.credited_amount
        THEN
            RAISE EXCEPTION 'Payment exceeds adjusted invoice balance';
        END IF;
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

ALTER TABLE accounting_entries
    ADD COLUMN source_invoice_refund_transaction_id UUID
        REFERENCES invoice_refund_transactions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_accounting_entry_refund_transaction_category
    ON accounting_entries(source_invoice_refund_transaction_id, category)
    WHERE source_invoice_refund_transaction_id IS NOT NULL;

CREATE INDEX idx_accounting_entries_refund_transaction
    ON accounting_entries(source_invoice_refund_transaction_id)
    WHERE source_invoice_refund_transaction_id IS NOT NULL;

COMMENT ON TABLE invoice_refund_transactions IS
    'Append-only cash refunds and their reversals. A refund consumes only an actual cash credit balance.';

COMMENT ON COLUMN accounting_entries.source_invoice_refund_transaction_id IS
    'Idempotency link to the cash refund or refund reversal that created this accounting entry.';
