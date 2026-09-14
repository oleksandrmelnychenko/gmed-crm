-- Patient-level billing may exist without an order. Store currency on the
-- invoice itself so payments, PDFs and accounting remain well-defined.

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS currency TEXT;

UPDATE invoices invoice
SET currency = UPPER(BTRIM(orders.currency))
FROM orders
WHERE orders.id = invoice.order_id
  AND invoice.currency IS NULL;

UPDATE invoices
SET currency = 'EUR'
WHERE currency IS NULL;

ALTER TABLE invoices
    ALTER COLUMN currency SET DEFAULT 'EUR',
    ALTER COLUMN currency SET NOT NULL,
    ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_currency_code;
ALTER TABLE invoices
    ADD CONSTRAINT invoices_currency_code
    CHECK (currency ~ '^[A-Z]{3}$');

CREATE OR REPLACE FUNCTION validate_patient_invoice_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    linked_patient_id UUID;
    linked_currency TEXT;
    linked_quote_order_id UUID;
BEGIN
    IF NEW.order_id IS NULL THEN
        IF NEW.quote_id IS NOT NULL THEN
            RAISE EXCEPTION 'invoice without order cannot reference a quote';
        END IF;
        IF NEW.invoice_type = 'advance' THEN
            RAISE EXCEPTION 'invoice without order cannot be an advance invoice';
        END IF;
        NEW.currency := UPPER(BTRIM(NEW.currency));
        IF NEW.currency !~ '^[A-Z]{3}$' THEN
            RAISE EXCEPTION 'invoice currency must be a three-letter code';
        END IF;
        RETURN NEW;
    END IF;

    SELECT patient_id, UPPER(BTRIM(currency))
    INTO linked_patient_id, linked_currency
    FROM orders
    WHERE id = NEW.order_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'invoice order not found';
    END IF;
    IF NEW.patient_id IS DISTINCT FROM linked_patient_id THEN
        RAISE EXCEPTION 'invoice patient must match order patient';
    END IF;
    IF NEW.quote_id IS NOT NULL THEN
        SELECT order_id INTO linked_quote_order_id
        FROM quotes
        WHERE id = NEW.quote_id
        FOR SHARE;
        IF linked_quote_order_id IS DISTINCT FROM NEW.order_id THEN
            RAISE EXCEPTION 'invoice quote must belong to invoice order';
        END IF;
    END IF;
    NEW.currency := linked_currency;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_patient_invoice_context_trigger ON invoices;
CREATE TRIGGER validate_patient_invoice_context_trigger
    BEFORE INSERT OR UPDATE OF order_id, patient_id, quote_id, invoice_type, currency
    ON invoices
    FOR EACH ROW EXECUTE FUNCTION validate_patient_invoice_context();

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
    IF source_invoice.order_id IS NULL OR target_invoice.order_id IS NULL
       OR source_invoice.patient_id IS DISTINCT FROM target_invoice.patient_id
       OR source_invoice.order_id IS DISTINCT FROM target_invoice.order_id THEN
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

CREATE OR REPLACE FUNCTION validate_external_patient_invoice_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    external_patient_id UUID;
    external_currency TEXT;
    external_status TEXT;
    external_receivable NUMERIC(12, 2);
    invoice_patient_id UUID;
    invoice_currency TEXT;
    invoice_status TEXT;
    invoice_type TEXT;
    invoice_total NUMERIC(12, 2);
    external_allocated NUMERIC(12, 2);
    invoice_allocated NUMERIC(12, 2);
BEGIN
    IF TG_OP = 'INSERT' AND NEW.reversed_at IS NOT NULL THEN
        RAISE EXCEPTION 'allocation cannot be created as reversed';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.external_invoice_id IS DISTINCT FROM NEW.external_invoice_id
            OR OLD.patient_invoice_id IS DISTINCT FROM NEW.patient_invoice_id
            OR OLD.amount_gross IS DISTINCT FROM NEW.amount_gross
            OR OLD.created_by IS DISTINCT FROM NEW.created_by
            OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
            RAISE EXCEPTION 'allocation financial fields are immutable';
        END IF;
        IF OLD.reversed_at IS NOT NULL AND (
            OLD.reversed_at IS DISTINCT FROM NEW.reversed_at
            OR OLD.reversed_by IS DISTINCT FROM NEW.reversed_by
            OR OLD.reversal_note IS DISTINCT FROM NEW.reversal_note
        ) THEN
            RAISE EXCEPTION 'reversed allocation is immutable';
        END IF;
    END IF;
    IF NEW.reversed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT external.patient_id, UPPER(external.currency), external.status,
           external.patient_receivable_gross
    INTO external_patient_id, external_currency, external_status, external_receivable
    FROM external_invoices external
    WHERE external.id = NEW.external_invoice_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'external invoice not found';
    END IF;

    SELECT invoice.patient_id, UPPER(invoice.currency), invoice.status,
           invoice.invoice_type, invoice.total_gross - invoice.credited_amount
    INTO invoice_patient_id, invoice_currency, invoice_status, invoice_type, invoice_total
    FROM invoices invoice
    WHERE invoice.id = NEW.patient_invoice_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'patient invoice not found';
    END IF;

    IF external_patient_id IS DISTINCT FROM invoice_patient_id
       OR external_currency IS DISTINCT FROM invoice_currency THEN
        RAISE EXCEPTION 'external and patient invoices must share patient and currency';
    END IF;
    IF external_status = 'cancelled' OR external_receivable <= 0 THEN
        RAISE EXCEPTION 'external invoice has no allocatable patient receivable';
    END IF;
    IF invoice_status = 'cancelled' OR invoice_type = 'advance' THEN
        RAISE EXCEPTION 'patient invoice is not eligible for receivable allocation';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO external_allocated
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN invoices linked_invoice ON linked_invoice.id = allocation.patient_invoice_id
    WHERE allocation.external_invoice_id = NEW.external_invoice_id
      AND allocation.id <> NEW.id
      AND allocation.reversed_at IS NULL
      AND linked_invoice.status <> 'cancelled';
    IF external_allocated + NEW.amount_gross > external_receivable THEN
        RAISE EXCEPTION 'allocation exceeds external patient receivable';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO invoice_allocated
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN external_invoices linked_external ON linked_external.id = allocation.external_invoice_id
    WHERE allocation.patient_invoice_id = NEW.patient_invoice_id
      AND allocation.id <> NEW.id
      AND allocation.reversed_at IS NULL
      AND linked_external.status <> 'cancelled';
    IF invoice_allocated + NEW.amount_gross > invoice_total THEN
        RAISE EXCEPTION 'allocation exceeds patient invoice gross total';
    END IF;
    RETURN NEW;
END;
$$;

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
    IF NEW.status = 'cancelled' THEN
        RETURN NEW;
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
        OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
        OR NEW.currency IS DISTINCT FROM OLD.currency THEN
        RAISE EXCEPTION 'patient invoice identity and currency are locked by active source allocations';
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

COMMENT ON COLUMN invoices.currency IS
    'Invoice currency independent of order context; normalized to the linked order currency when present.';
