-- Legal invoice corrections are append-only credit-note transactions. The invoice
-- keeps a derived credited_amount cache so all balance consumers can stay cheap,
-- while the journal remains the source of truth.

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Every financial mutation initiated by the UI carries a durable request key.
-- Existing imported payment rows may legitimately have no key, while allocations
-- are backfilled with generated keys and are one immutable row per operation.
ALTER TABLE invoice_payment_transactions
    ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payment_transaction_request
    ON invoice_payment_transactions(invoice_id, request_id)
    WHERE transaction_type = 'payment' AND request_id IS NOT NULL;

ALTER TABLE invoice_prepayment_allocations
    ADD COLUMN IF NOT EXISTS request_id UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT constraint_row.conname
        FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'invoice_prepayment_allocations'::regclass
          AND constraint_row.contype = 'u'
          AND (
              SELECT array_agg(attribute.attname ORDER BY attribute.attname)
              FROM unnest(constraint_row.conkey) AS key_column(attnum)
              JOIN pg_attribute attribute
                ON attribute.attrelid = constraint_row.conrelid
               AND attribute.attnum = key_column.attnum
          ) = ARRAY['advance_invoice_id', 'target_invoice_id']::name[]
    LOOP
        EXECUTE format(
            'ALTER TABLE invoice_prepayment_allocations DROP CONSTRAINT %I',
            constraint_name
        );
    END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_prepayment_allocation_request
    ON invoice_prepayment_allocations(target_invoice_id, request_id);

CREATE TABLE IF NOT EXISTS invoice_prepayment_allocation_requests (
    target_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    advance_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    allocation_id UUID REFERENCES invoice_prepayment_allocations(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (target_invoice_id, request_id)
);

ALTER TABLE external_invoice_patient_invoice_allocations
    ADD COLUMN IF NOT EXISTS request_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_external_patient_invoice_allocation_request
    ON external_invoice_patient_invoice_allocations(external_invoice_id, request_id);

CREATE OR REPLACE FUNCTION protect_financial_allocation_request_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.request_id IS DISTINCT FROM NEW.request_id THEN
        RAISE EXCEPTION 'financial allocation request_id is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_prepayment_allocation_request_id_trigger
    BEFORE UPDATE ON invoice_prepayment_allocations
    FOR EACH ROW
    EXECUTE FUNCTION protect_financial_allocation_request_id();

CREATE TRIGGER protect_external_allocation_request_id_trigger
    BEFORE UPDATE ON external_invoice_patient_invoice_allocations
    FOR EACH ROW
    EXECUTE FUNCTION protect_financial_allocation_request_id();

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_credited_amount_valid;

ALTER TABLE invoices
    ADD CONSTRAINT invoices_credited_amount_valid
    CHECK (credited_amount >= 0 AND credited_amount <= total_gross);

CREATE SEQUENCE IF NOT EXISTS invoice_credit_note_number_seq START 1;

CREATE TABLE invoice_credit_note_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL
        CHECK (transaction_type IN ('credit_note', 'reversal')),
    request_id UUID,
    reverses_transaction_id UUID
        REFERENCES invoice_credit_note_transactions(id) ON DELETE RESTRICT,
    document_number TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    amount_net NUMERIC(12, 2) NOT NULL CHECK (amount_net >= 0),
    amount_vat NUMERIC(12, 2) NOT NULL CHECK (amount_vat >= 0),
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    issued_on DATE NOT NULL,
    portal_visible BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_credit_note_amount_consistency
        CHECK (round(amount_net + amount_vat, 2) = amount_gross),
    CONSTRAINT invoice_credit_note_transaction_shape CHECK (
        (transaction_type = 'credit_note' AND reverses_transaction_id IS NULL AND request_id IS NOT NULL)
        OR
        (transaction_type = 'reversal' AND reverses_transaction_id IS NOT NULL AND request_id IS NULL)
    )
);

CREATE INDEX idx_invoice_credit_note_transactions_invoice
    ON invoice_credit_note_transactions(invoice_id, issued_on DESC, created_at DESC);

CREATE UNIQUE INDEX uq_invoice_credit_note_transaction_reversal
    ON invoice_credit_note_transactions(reverses_transaction_id)
    WHERE transaction_type = 'reversal';

CREATE UNIQUE INDEX uq_invoice_credit_note_request
    ON invoice_credit_note_transactions(invoice_id, request_id)
    WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_invoice_credit_note_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    invoice_total NUMERIC(12, 2);
    invoice_status TEXT;
    invoice_currency TEXT;
    invoice_issued_on DATE;
    original invoice_credit_note_transactions%ROWTYPE;
    active_credit NUMERIC(12, 2);
    allocated_external NUMERIC(12, 2);
    allocated_advance NUMERIC(12, 2);
    applied_prepayment NUMERIC(12, 2);
BEGIN
    SELECT invoice.total_gross, invoice.status, UPPER(orders.currency), invoice.issued_at::date
    INTO invoice_total, invoice_status, invoice_currency, invoice_issued_on
    FROM invoices invoice
    JOIN orders ON orders.id = invoice.order_id
    WHERE invoice.id = NEW.invoice_id
    FOR UPDATE OF invoice;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invoice for credit note does not exist';
    END IF;
    IF invoice_status IN ('draft', 'cancelled') THEN
        RAISE EXCEPTION 'credit notes require an active released invoice';
    END IF;
    IF UPPER(NEW.currency) <> invoice_currency THEN
        RAISE EXCEPTION 'credit note currency must match invoice order currency';
    END IF;

    IF NEW.transaction_type = 'reversal' THEN
        SELECT * INTO original
        FROM invoice_credit_note_transactions
        WHERE id = NEW.reverses_transaction_id
        FOR UPDATE;

        IF NOT FOUND
            OR original.invoice_id <> NEW.invoice_id
            OR original.transaction_type <> 'credit_note'
            OR original.amount_net <> NEW.amount_net
            OR original.amount_vat <> NEW.amount_vat
            OR original.amount_gross <> NEW.amount_gross
            OR original.currency <> NEW.currency
        THEN
            RAISE EXCEPTION 'credit-note reversal must match its original transaction';
        END IF;
        IF NEW.issued_on < original.issued_on THEN
            RAISE EXCEPTION 'credit-note reversal date cannot precede the original credit note';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM invoice_credit_note_transactions reversal
            WHERE reversal.reverses_transaction_id = original.id
              AND reversal.transaction_type = 'reversal'
        ) THEN
            RAISE EXCEPTION 'credit note was already reversed';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.issued_on < invoice_issued_on THEN
        RAISE EXCEPTION 'credit-note date cannot precede the invoice date';
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'credit_note' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO active_credit
    FROM invoice_credit_note_transactions
    WHERE invoice_id = NEW.invoice_id;

    IF active_credit + NEW.amount_gross > invoice_total THEN
        RAISE EXCEPTION 'credit note exceeds the invoice gross total';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO allocated_external
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN external_invoices external ON external.id = allocation.external_invoice_id
    WHERE allocation.patient_invoice_id = NEW.invoice_id
      AND allocation.reversed_at IS NULL
      AND external.status <> 'cancelled';

    IF invoice_total - active_credit - NEW.amount_gross < allocated_external THEN
        RAISE EXCEPTION 'credit note would reduce invoice below reconciled external receivables';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO allocated_advance
    FROM invoice_prepayment_allocations allocation
    WHERE allocation.advance_invoice_id = NEW.invoice_id;

    IF invoice_total - active_credit - NEW.amount_gross < allocated_advance THEN
        RAISE EXCEPTION 'credit note would reduce advance below applied prepayments';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO applied_prepayment
    FROM invoice_prepayment_allocations allocation
    WHERE allocation.target_invoice_id = NEW.invoice_id;

    IF invoice_total - active_credit - NEW.amount_gross < applied_prepayment THEN
        RAISE EXCEPTION 'credit note would reduce invoice below applied prepayments';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_invoice_credit_note_transaction_trigger
    BEFORE INSERT ON invoice_credit_note_transactions
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_credit_note_transaction();

CREATE OR REPLACE FUNCTION protect_invoice_credit_note_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'credit-note transactions are append-only; create a reversal instead';
END;
$$;

CREATE TRIGGER protect_invoice_credit_note_transaction_trigger
    BEFORE UPDATE OR DELETE ON invoice_credit_note_transactions
    FOR EACH ROW
    EXECUTE FUNCTION protect_invoice_credit_note_transaction();

CREATE OR REPLACE FUNCTION refresh_invoice_credited_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE invoices
    SET credited_amount = COALESCE((
        SELECT SUM(
            CASE WHEN transaction_type = 'credit_note' THEN amount_gross ELSE -amount_gross END
        )
        FROM invoice_credit_note_transactions
        WHERE invoice_id = NEW.invoice_id
    ), 0)
    WHERE id = NEW.invoice_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER refresh_invoice_credited_amount_trigger
    AFTER INSERT ON invoice_credit_note_transactions
    FOR EACH ROW
    EXECUTE FUNCTION refresh_invoice_credited_amount();

-- Payments and prepayment allocations must respect the adjusted invoice gross.
CREATE OR REPLACE FUNCTION validate_invoice_payment_transaction()
RETURNS trigger AS $$
DECLARE
    invoice_row invoices%ROWTYPE;
    original invoice_payment_transactions%ROWTYPE;
    current_cash_paid NUMERIC(12, 2);
BEGIN
    SELECT * INTO invoice_row
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
            CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
        ), 0)
        INTO current_cash_paid
        FROM invoice_payment_transactions
        WHERE invoice_id = NEW.invoice_id;

        IF current_cash_paid + NEW.amount_gross + invoice_row.prepayment_applied_amount
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
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_invoice_prepayment_allocation()
RETURNS trigger AS $$
DECLARE
    source_invoice invoices%ROWTYPE;
    target_invoice invoices%ROWTYPE;
    source_allocated NUMERIC;
    target_allocated NUMERIC;
BEGIN
    SELECT * INTO source_invoice FROM invoices
    WHERE id = NEW.advance_invoice_id FOR UPDATE;
    SELECT * INTO target_invoice FROM invoices
    WHERE id = NEW.target_invoice_id FOR UPDATE;

    IF source_invoice.id IS NULL OR target_invoice.id IS NULL THEN
        RAISE EXCEPTION 'Invoice for prepayment allocation does not exist';
    END IF;
    IF source_invoice.invoice_type <> 'advance' OR source_invoice.status = 'cancelled' THEN
        RAISE EXCEPTION 'Prepayment source must be an active advance invoice';
    END IF;
    IF target_invoice.invoice_type = 'advance' OR target_invoice.status = 'cancelled' THEN
        RAISE EXCEPTION 'Prepayment target must be an active settlement invoice';
    END IF;
    IF source_invoice.patient_id <> target_invoice.patient_id
       OR source_invoice.order_id <> target_invoice.order_id THEN
        RAISE EXCEPTION 'Prepayment invoices must belong to the same patient and order';
    END IF;

    SELECT COALESCE(SUM(amount_gross), 0) INTO source_allocated
    FROM invoice_prepayment_allocations
    WHERE advance_invoice_id = NEW.advance_invoice_id AND id <> NEW.id;
    IF source_allocated + NEW.amount_gross > LEAST(
        source_invoice.paid_amount,
        source_invoice.total_gross - source_invoice.credited_amount
    ) THEN
        RAISE EXCEPTION 'Prepayment allocation exceeds paid advance balance';
    END IF;

    SELECT COALESCE(SUM(amount_gross), 0) INTO target_allocated
    FROM invoice_prepayment_allocations
    WHERE target_invoice_id = NEW.target_invoice_id AND id <> NEW.id;
    IF target_allocated + NEW.amount_gross + target_invoice.paid_amount
        > target_invoice.total_gross - target_invoice.credited_amount
    THEN
        RAISE EXCEPTION 'Prepayment allocation exceeds adjusted target invoice balance';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The source migration validates the external receivable capacity. This second
-- guard validates the target invoice capacity after legal credit notes.
CREATE OR REPLACE FUNCTION validate_external_allocation_adjusted_invoice_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    adjusted_invoice_total NUMERIC(12, 2);
    already_allocated NUMERIC(12, 2);
BEGIN
    IF NEW.reversed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT total_gross - credited_amount
    INTO adjusted_invoice_total
    FROM invoices
    WHERE id = NEW.patient_invoice_id
    FOR UPDATE;

    SELECT COALESCE(SUM(amount_gross), 0)
    INTO already_allocated
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN external_invoices external ON external.id = allocation.external_invoice_id
    WHERE allocation.patient_invoice_id = NEW.patient_invoice_id
      AND allocation.reversed_at IS NULL
      AND allocation.id <> NEW.id
      AND external.status <> 'cancelled';

    IF already_allocated + NEW.amount_gross > adjusted_invoice_total THEN
        RAISE EXCEPTION 'external allocation exceeds adjusted patient invoice total';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_external_allocation_adjusted_invoice_total_trigger
    BEFORE INSERT OR UPDATE ON external_invoice_patient_invoice_allocations
    FOR EACH ROW
    EXECUTE FUNCTION validate_external_allocation_adjusted_invoice_total();

CREATE OR REPLACE FUNCTION protect_patient_invoice_source_allocations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    active_allocated NUMERIC(12, 2);
BEGIN
    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO active_allocated
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN external_invoices external ON external.id = allocation.external_invoice_id
    WHERE allocation.patient_invoice_id = OLD.id
      AND allocation.reversed_at IS NULL
      AND external.status <> 'cancelled';

    IF active_allocated <= 0 THEN
        RETURN NEW;
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
        OR NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
        RAISE EXCEPTION 'patient invoice identity is locked by active source allocations';
    END IF;
    IF NEW.status IN ('draft', 'cancelled') THEN
        RETURN NEW;
    END IF;
    IF NEW.invoice_type = 'advance' THEN
        RAISE EXCEPTION 'patient invoice type is locked by active source allocations';
    END IF;
    IF NEW.total_gross - NEW.credited_amount < active_allocated THEN
        RAISE EXCEPTION 'adjusted patient invoice gross cannot be lower than active source allocations';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_patient_invoice_source_allocations ON invoices;

CREATE TRIGGER trg_protect_patient_invoice_source_allocations
    BEFORE UPDATE OF order_id, patient_id, invoice_type, status, total_gross, credited_amount
    ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION protect_patient_invoice_source_allocations();

-- Cancelled financial documents are terminal. Reactivation can resurrect inactive
-- receivable allocations and violate source allocation totals.
CREATE OR REPLACE FUNCTION protect_cancelled_invoice_reactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'cancelled invoices cannot be reactivated';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_cancelled_invoice_reactivation_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION protect_cancelled_invoice_reactivation();

CREATE OR REPLACE FUNCTION protect_cancelled_external_invoice_reactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'cancelled external invoices cannot be reactivated';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_cancelled_external_invoice_reactivation_trigger
    BEFORE UPDATE OF status ON external_invoices
    FOR EACH ROW
    EXECUTE FUNCTION protect_cancelled_external_invoice_reactivation();

CREATE OR REPLACE FUNCTION validate_invoice_cancellation_financials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    net_cash NUMERIC(12, 2);
BEGIN
    IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
        SELECT COALESCE(SUM(
            CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
        ), 0)
        INTO net_cash
        FROM invoice_payment_transactions
        WHERE invoice_id = OLD.id;

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

CREATE TRIGGER validate_invoice_cancellation_financials_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_cancellation_financials();

CREATE OR REPLACE FUNCTION protect_allocated_order_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF UPPER(NEW.currency) IS DISTINCT FROM UPPER(OLD.currency)
       AND (
           EXISTS (
               SELECT 1
               FROM external_invoice_patient_invoice_allocations allocation
               JOIN external_invoices external ON external.id = allocation.external_invoice_id
               JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
               WHERE allocation.reversed_at IS NULL
                 AND external.status <> 'cancelled'
                 AND patient_invoice.status NOT IN ('draft', 'cancelled')
                 AND (external.order_id = OLD.id OR patient_invoice.order_id = OLD.id)
           )
           OR EXISTS (
               SELECT 1
               FROM invoice_credit_note_transactions credit
               JOIN invoices invoice ON invoice.id = credit.invoice_id
               WHERE invoice.order_id = OLD.id
           )
       ) THEN
        RAISE EXCEPTION 'order currency is locked by financial journals';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON TABLE invoice_credit_note_transactions IS
    'Append-only legal invoice credit notes and their reversals.';

COMMENT ON COLUMN invoices.credited_amount IS
    'Derived active gross credit-note total; invoice_credit_note_transactions is authoritative.';
