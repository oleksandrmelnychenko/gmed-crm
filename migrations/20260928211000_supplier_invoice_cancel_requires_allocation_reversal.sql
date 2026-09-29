-- A supplier invoice allocated to a patient invoice is billed to the patient
-- through that invoice. Until 2026-09-28 the supplier invoice could still be
-- cancelled while the allocation stayed active, so the patient invoice kept
-- billing a cost that no longer existed. Cancelling now requires reversing
-- the active allocations first (owner decision 2026-09-28, status audit Q13).
-- The server checks this first and answers 409; this trigger is the backstop.
-- Existing cancelled invoices are not touched.
CREATE OR REPLACE FUNCTION protect_external_invoice_allocated_receivable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    active_allocated NUMERIC(12, 2);
    next_receivable NUMERIC(12, 2);
BEGIN
    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO active_allocated
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
    WHERE allocation.external_invoice_id = OLD.id
      AND allocation.reversed_at IS NULL
      AND patient_invoice.status <> 'cancelled';
    IF active_allocated <= 0 THEN
        RETURN NEW;
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
        OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
        OR UPPER(NEW.currency) IS DISTINCT FROM UPPER(OLD.currency) THEN
        RAISE EXCEPTION 'external invoice identity and currency are locked by active allocations';
    END IF;
    IF NEW.status = 'cancelled' THEN
        IF OLD.status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'reverse active patient-invoice allocations before cancelling the external invoice'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    next_receivable := CASE
        WHEN NEW.paid_by = 'agency'
          OR (NEW.paid_by = 'unpaid' AND NEW.service_delivered)
        THEN NEW.amount_gross ELSE 0
    END;
    IF next_receivable < active_allocated THEN
        RAISE EXCEPTION 'external patient receivable cannot be lower than active allocations';
    END IF;
    RETURN NEW;
END;
$$;
