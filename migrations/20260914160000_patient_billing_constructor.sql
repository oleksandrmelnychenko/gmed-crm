-- Patient billing is patient-scoped: a supplier invoice may arrive after its
-- original order is closed and can be re-invoiced together with later costs.
-- Draft patient invoices reserve their sources so the same cost cannot be
-- selected in two concurrent billing drafts.

CREATE TABLE IF NOT EXISTS patient_billing_invoice_requests (
    request_id UUID PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_invoice_patient_payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_invoice_id UUID NOT NULL REFERENCES external_invoices(id) ON DELETE RESTRICT,
    request_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('patient_paid', 'patient_payment_reopened')),
    effective_on DATE NOT NULL,
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (external_invoice_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_external_invoice_patient_payment_events_invoice
    ON external_invoice_patient_payment_events(external_invoice_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_external_invoice_patient_payment_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'patient payment events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS protect_external_invoice_patient_payment_event_trigger
    ON external_invoice_patient_payment_events;
CREATE TRIGGER protect_external_invoice_patient_payment_event_trigger
    BEFORE UPDATE OR DELETE ON external_invoice_patient_payment_events
    FOR EACH ROW EXECUTE FUNCTION protect_external_invoice_patient_payment_event();

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

    SELECT external.patient_id, external.currency, external.status,
           external.patient_receivable_gross
    INTO external_patient_id, external_currency, external_status, external_receivable
    FROM external_invoices external
    WHERE external.id = NEW.external_invoice_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'external invoice not found';
    END IF;

    SELECT invoice.patient_id, orders.currency, invoice.status,
           invoice.invoice_type, invoice.total_gross - invoice.credited_amount
    INTO invoice_patient_id, invoice_currency, invoice_status, invoice_type, invoice_total
    FROM invoices invoice
    JOIN orders ON orders.id = invoice.order_id
    WHERE invoice.id = NEW.patient_invoice_id
    FOR UPDATE OF invoice;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'patient invoice not found';
    END IF;

    IF external_patient_id IS DISTINCT FROM invoice_patient_id
       OR UPPER(external_currency) IS DISTINCT FROM UPPER(invoice_currency) THEN
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
        OR NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
        RAISE EXCEPTION 'patient invoice identity is locked by active source allocations';
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
                 AND patient_invoice.status <> 'cancelled'
                 AND (external.order_id = OLD.id OR patient_invoice.order_id = OLD.id)
           )
           OR EXISTS (
               SELECT 1
               FROM invoice_credit_note_transactions credit
               JOIN invoices invoice ON invoice.id = credit.invoice_id
               WHERE invoice.order_id = OLD.id
           )
       ) THEN
        RAISE EXCEPTION 'order currency is locked by active invoice allocations';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW external_invoice_receivable_balances AS
SELECT external.id AS external_invoice_id,
       CASE WHEN external.invoice_scope = 'company' THEN 0
            ELSE external.patient_receivable_gross END::NUMERIC(12, 2)
            AS patient_receivable_gross,
       COALESCE(SUM(allocation.amount_gross) FILTER (
           WHERE allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'
             AND patient_invoice.status <> 'cancelled'
       ), 0)::NUMERIC(12, 2) AS allocated_receivable_gross,
       CASE WHEN external.invoice_scope = 'company' THEN 0
            ELSE GREATEST(
                external.patient_receivable_gross
                - COALESCE(SUM(allocation.amount_gross) FILTER (
                    WHERE allocation.reversed_at IS NULL
                      AND external.status <> 'cancelled'
                      AND patient_invoice.status <> 'cancelled'
                ), 0), 0)
       END::NUMERIC(12, 2) AS remaining_receivable_gross
FROM external_invoices external
LEFT JOIN external_invoice_patient_invoice_allocations allocation
       ON allocation.external_invoice_id = external.id
LEFT JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
GROUP BY external.id, external.invoice_scope, external.patient_receivable_gross;

COMMENT ON TABLE patient_billing_invoice_requests IS
    'Idempotency keys for patient-level invoices assembled from services and reimbursable supplier costs.';
COMMENT ON TABLE external_invoice_patient_payment_events IS
    'Append-only evidence that a provider invoice was paid directly by the patient or reopened.';
COMMENT ON VIEW external_invoice_receivable_balances IS
    'Patient receivable balance including amounts reserved by active draft invoices.';
