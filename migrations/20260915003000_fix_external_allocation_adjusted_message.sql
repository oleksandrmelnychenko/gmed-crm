-- Keep the allocation error aligned with the adjusted invoice total that the
-- guard actually checks. The order-optional invoice migration redefined this
-- function after the original credit-note hardening and restored the older,
-- inaccurate "gross total" message.
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
        RAISE EXCEPTION 'external allocation exceeds adjusted patient invoice total';
    END IF;
    RETURN NEW;
END;
$$;
