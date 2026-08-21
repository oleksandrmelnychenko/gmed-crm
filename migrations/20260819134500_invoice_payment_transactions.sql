-- Replace mutable invoice payment totals with an append-only receipt journal.
-- Existing totals become explicit opening transactions so every subsequent
-- recomputation can use the journal as its sole cash-payment source.

CREATE TABLE invoice_payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL
        CHECK (transaction_type IN ('payment', 'reversal')),
    reverses_transaction_id UUID REFERENCES invoice_payment_transactions(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    payment_method TEXT NOT NULL CHECK (
        payment_method IN (
            'bank_transfer',
            'card',
            'cash',
            'direct_debit',
            'cheque',
            'other',
            'legacy_import'
        )
    ),
    payment_reference TEXT,
    received_on DATE NOT NULL,
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_payment_transaction_shape CHECK (
        (transaction_type = 'payment' AND reverses_transaction_id IS NULL)
        OR
        (transaction_type = 'reversal' AND reverses_transaction_id IS NOT NULL)
    )
);

CREATE INDEX idx_invoice_payment_transactions_invoice
    ON invoice_payment_transactions(invoice_id, received_on DESC, created_at DESC);

CREATE UNIQUE INDEX uq_invoice_payment_transaction_reversal
    ON invoice_payment_transactions(reverses_transaction_id)
    WHERE transaction_type = 'reversal';

INSERT INTO invoice_payment_transactions (
    invoice_id,
    transaction_type,
    amount_gross,
    payment_method,
    received_on,
    note,
    created_by,
    created_at
)
SELECT
    invoice.id,
    'payment',
    round(invoice.paid_amount, 2),
    'legacy_import',
    COALESCE(invoice.paid_at::date, invoice.issued_at::date),
    'Imported opening payment balance',
    invoice.created_by,
    COALESCE(invoice.paid_at, invoice.updated_at, invoice.created_at)
FROM invoices invoice
WHERE invoice.paid_amount > 0;

CREATE OR REPLACE FUNCTION validate_invoice_payment_transaction()
RETURNS trigger AS $$
DECLARE
    invoice_row invoices%ROWTYPE;
    original invoice_payment_transactions%ROWTYPE;
    current_cash_paid NUMERIC(12, 2);
BEGIN
    SELECT *
    INTO invoice_row
    FROM invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice for payment transaction does not exist';
    END IF;

    IF NEW.transaction_type = 'payment' THEN
        IF invoice_row.status IN ('draft', 'cancelled') THEN
            RAISE EXCEPTION 'Payments require an active released invoice';
        END IF;

        SELECT COALESCE(SUM(
            CASE
                WHEN transaction_type = 'payment' THEN amount_gross
                ELSE -amount_gross
            END
        ), 0)
        INTO current_cash_paid
        FROM invoice_payment_transactions
        WHERE invoice_id = NEW.invoice_id;

        IF current_cash_paid + NEW.amount_gross + invoice_row.prepayment_applied_amount
            > invoice_row.total_gross
        THEN
            RAISE EXCEPTION 'Payment exceeds invoice balance';
        END IF;

        RETURN NEW;
    END IF;

    SELECT *
    INTO original
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
        SELECT 1
        FROM invoice_payment_transactions reversal
        WHERE reversal.reverses_transaction_id = original.id
          AND reversal.transaction_type = 'reversal'
    ) THEN
        RAISE EXCEPTION 'Payment was already reversed';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_invoice_payment_transaction_trigger
    BEFORE INSERT ON invoice_payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_payment_transaction();

CREATE OR REPLACE FUNCTION protect_invoice_payment_transaction()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Invoice payment transactions are append-only; create a reversal instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_invoice_payment_transaction_trigger
    BEFORE UPDATE OR DELETE ON invoice_payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION protect_invoice_payment_transaction();

ALTER TABLE accounting_entries
    ADD COLUMN source_invoice_payment_transaction_id UUID
        REFERENCES invoice_payment_transactions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_accounting_entry_payment_transaction_category
    ON accounting_entries(source_invoice_payment_transaction_id, category)
    WHERE source_invoice_payment_transaction_id IS NOT NULL;

CREATE INDEX idx_accounting_entries_payment_transaction
    ON accounting_entries(source_invoice_payment_transaction_id)
    WHERE source_invoice_payment_transaction_id IS NOT NULL;

COMMENT ON TABLE invoice_payment_transactions IS
    'Append-only cash receipts and their reversals. invoices.paid_amount is a derived cache.';

COMMENT ON COLUMN accounting_entries.source_invoice_payment_transaction_id IS
    'Idempotency link to the receipt or reversal that created this accounting entry.';
