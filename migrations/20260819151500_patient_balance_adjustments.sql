-- Manual patient settlement adjustments cover balances that are not represented
-- by an invoice, payment, credit note, refund, prepayment, or external receivable.
-- They are immutable journal entries; corrections are recorded as reversals.

CREATE TABLE patient_balance_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL
        CHECK (transaction_type IN ('adjustment', 'reversal')),
    request_id UUID NOT NULL,
    reverses_adjustment_id UUID
        REFERENCES patient_balance_adjustments(id) ON DELETE RESTRICT,
    direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    category TEXT NOT NULL CHECK (
        category IN ('opening_balance', 'fee', 'goodwill', 'correction', 'other')
    ),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (
        currency = upper(currency)
        AND currency ~ '^[A-Z]{3}$'
    ),
    effective_on DATE NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    note TEXT,
    portal_visible BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT patient_balance_adjustment_shape CHECK (
        (
            transaction_type = 'adjustment'
            AND reverses_adjustment_id IS NULL
        )
        OR
        (
            transaction_type = 'reversal'
            AND reverses_adjustment_id IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX uq_patient_balance_adjustment_request
    ON patient_balance_adjustments(patient_id, request_id);

CREATE UNIQUE INDEX uq_patient_balance_adjustment_reversal
    ON patient_balance_adjustments(reverses_adjustment_id)
    WHERE transaction_type = 'reversal';

CREATE INDEX idx_patient_balance_adjustments_statement
    ON patient_balance_adjustments(patient_id, currency, effective_on, created_at);

CREATE OR REPLACE FUNCTION validate_patient_balance_adjustment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    original patient_balance_adjustments%ROWTYPE;
    order_patient_id UUID;
    order_currency TEXT;
BEGIN
    PERFORM 1
    FROM patients
    WHERE id = NEW.patient_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Patient for balance adjustment does not exist';
    END IF;

    IF NEW.order_id IS NOT NULL THEN
        SELECT patient_id, currency
        INTO order_patient_id, order_currency
        FROM orders
        WHERE id = NEW.order_id
        FOR SHARE;

        IF NOT FOUND
            OR order_patient_id <> NEW.patient_id
            OR upper(order_currency) <> NEW.currency
        THEN
            RAISE EXCEPTION 'Adjustment order must belong to the patient and use the same currency';
        END IF;
    END IF;

    IF NEW.transaction_type = 'reversal' THEN
        SELECT *
        INTO original
        FROM patient_balance_adjustments
        WHERE id = NEW.reverses_adjustment_id
        FOR UPDATE;

        IF NOT FOUND
            OR original.patient_id <> NEW.patient_id
            OR original.transaction_type <> 'adjustment'
        THEN
            RAISE EXCEPTION 'Adjustment reversal must reference an adjustment for the same patient';
        END IF;
        IF NEW.direction = original.direction
            OR NEW.category <> original.category
            OR NEW.amount <> original.amount
            OR NEW.currency <> original.currency
            OR NEW.order_id IS DISTINCT FROM original.order_id
            OR NEW.portal_visible <> original.portal_visible
        THEN
            RAISE EXCEPTION 'Adjustment reversal must mirror the original adjustment';
        END IF;
        IF NEW.effective_on < original.effective_on THEN
            RAISE EXCEPTION 'Adjustment reversal date cannot precede the original adjustment';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM patient_balance_adjustments reversal
            WHERE reversal.reverses_adjustment_id = original.id
              AND reversal.transaction_type = 'reversal'
        ) THEN
            RAISE EXCEPTION 'Balance adjustment was already reversed';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_patient_balance_adjustment_trigger
    BEFORE INSERT ON patient_balance_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION validate_patient_balance_adjustment();

CREATE OR REPLACE FUNCTION protect_patient_balance_adjustment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Patient balance adjustments are append-only; create a reversal instead';
END;
$$;

CREATE TRIGGER protect_patient_balance_adjustment_trigger
    BEFORE UPDATE OR DELETE ON patient_balance_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION protect_patient_balance_adjustment();

COMMENT ON TABLE patient_balance_adjustments IS
    'Append-only manual debit/credit settlement adjustments and their reversals.';

COMMENT ON COLUMN patient_balance_adjustments.portal_visible IS
    'Controls whether the adjustment reason is disclosed in the patient portal; amount and date always remain part of the patient balance.';
