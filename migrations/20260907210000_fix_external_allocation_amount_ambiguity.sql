-- Preserve existing migration checksums while fixing the joined aggregate.
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

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
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
