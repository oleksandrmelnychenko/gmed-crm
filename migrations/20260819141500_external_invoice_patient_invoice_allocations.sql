CREATE TABLE IF NOT EXISTS external_invoice_patient_invoice_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_invoice_id UUID NOT NULL
        REFERENCES external_invoices(id) ON DELETE RESTRICT,
    patient_invoice_id UUID NOT NULL
        REFERENCES invoices(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reversal_note TEXT,
    CONSTRAINT external_patient_invoice_allocation_reversal_consistent CHECK (
        (reversed_at IS NULL AND reversed_by IS NULL)
        OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_external_patient_invoice_allocations_external_active
    ON external_invoice_patient_invoice_allocations(external_invoice_id, created_at)
    WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_external_patient_invoice_allocations_patient_active
    ON external_invoice_patient_invoice_allocations(patient_invoice_id, created_at)
    WHERE reversed_at IS NULL;

CREATE OR REPLACE FUNCTION validate_external_patient_invoice_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    external_order_id UUID;
    external_patient_id UUID;
    external_currency TEXT;
    external_status TEXT;
    external_receivable NUMERIC(12, 2);
    invoice_order_id UUID;
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

    SELECT external.order_id,
           external.patient_id,
           external.currency,
           external.status,
           external.patient_receivable_gross
    INTO external_order_id,
         external_patient_id,
         external_currency,
         external_status,
         external_receivable
    FROM external_invoices external
    WHERE external.id = NEW.external_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'external invoice not found';
    END IF;

    SELECT invoice.order_id,
           invoice.patient_id,
           orders.currency,
           invoice.status,
           invoice.invoice_type,
           invoice.total_gross
    INTO invoice_order_id,
         invoice_patient_id,
         invoice_currency,
         invoice_status,
         invoice_type,
         invoice_total
    FROM invoices invoice
    JOIN orders ON orders.id = invoice.order_id
    WHERE invoice.id = NEW.patient_invoice_id
    FOR UPDATE OF invoice;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'patient invoice not found';
    END IF;

    IF external_order_id <> invoice_order_id
        OR external_patient_id <> invoice_patient_id
        OR UPPER(external_currency) <> UPPER(invoice_currency) THEN
        RAISE EXCEPTION 'external and patient invoices must share order, patient and currency';
    END IF;
    IF external_status = 'cancelled' OR external_receivable <= 0 THEN
        RAISE EXCEPTION 'external invoice has no allocatable patient receivable';
    END IF;
    IF invoice_status IN ('draft', 'cancelled') OR invoice_type = 'advance' THEN
        RAISE EXCEPTION 'patient invoice is not eligible for receivable allocation';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO external_allocated
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN invoices linked_invoice ON linked_invoice.id = allocation.patient_invoice_id
    WHERE allocation.external_invoice_id = NEW.external_invoice_id
      AND allocation.id <> NEW.id
      AND allocation.reversed_at IS NULL
      AND linked_invoice.status NOT IN ('draft', 'cancelled');

    IF external_allocated + NEW.amount_gross > external_receivable THEN
        RAISE EXCEPTION 'allocation exceeds external patient receivable';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO invoice_allocated
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN external_invoices linked_external
      ON linked_external.id = allocation.external_invoice_id
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

DROP TRIGGER IF EXISTS trg_validate_external_patient_invoice_allocation
    ON external_invoice_patient_invoice_allocations;

CREATE TRIGGER trg_validate_external_patient_invoice_allocation
BEFORE INSERT OR UPDATE ON external_invoice_patient_invoice_allocations
FOR EACH ROW
EXECUTE FUNCTION validate_external_patient_invoice_allocation();

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
      AND patient_invoice.status NOT IN ('draft', 'cancelled');

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
        THEN NEW.amount_gross
        ELSE 0
    END;
    IF next_receivable < active_allocated THEN
        RAISE EXCEPTION 'external patient receivable cannot be lower than active allocations';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_external_invoice_allocated_receivable
    ON external_invoices;

CREATE TRIGGER trg_protect_external_invoice_allocated_receivable
BEFORE UPDATE OF order_id, patient_id, currency, status, paid_by, service_delivered, amount_gross
ON external_invoices
FOR EACH ROW
EXECUTE FUNCTION protect_external_invoice_allocated_receivable();

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
    IF NEW.total_gross < active_allocated THEN
        RAISE EXCEPTION 'patient invoice gross cannot be lower than active source allocations';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_patient_invoice_source_allocations ON invoices;

CREATE TRIGGER trg_protect_patient_invoice_source_allocations
BEFORE UPDATE OF order_id, patient_id, invoice_type, status, total_gross
ON invoices
FOR EACH ROW
EXECUTE FUNCTION protect_patient_invoice_source_allocations();

CREATE OR REPLACE FUNCTION protect_allocated_order_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF UPPER(NEW.currency) IS DISTINCT FROM UPPER(OLD.currency)
       AND EXISTS (
           SELECT 1
           FROM external_invoice_patient_invoice_allocations allocation
           JOIN external_invoices external ON external.id = allocation.external_invoice_id
           JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
           WHERE allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'
             AND patient_invoice.status NOT IN ('draft', 'cancelled')
             AND (external.order_id = OLD.id OR patient_invoice.order_id = OLD.id)
       ) THEN
        RAISE EXCEPTION 'order currency is locked by active invoice allocations';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_allocated_order_currency ON orders;

CREATE TRIGGER trg_protect_allocated_order_currency
BEFORE UPDATE OF currency ON orders
FOR EACH ROW
EXECUTE FUNCTION protect_allocated_order_currency();

CREATE OR REPLACE VIEW external_invoice_receivable_balances AS
SELECT external.id AS external_invoice_id,
       external.patient_receivable_gross,
       COALESCE(SUM(allocation.amount_gross) FILTER (
           WHERE allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'
             AND patient_invoice.status NOT IN ('draft', 'cancelled')
       ), 0)::NUMERIC(12, 2) AS allocated_receivable_gross,
       GREATEST(
           external.patient_receivable_gross
           - COALESCE(SUM(allocation.amount_gross) FILTER (
               WHERE allocation.reversed_at IS NULL
                 AND external.status <> 'cancelled'
                 AND patient_invoice.status NOT IN ('draft', 'cancelled')
           ), 0),
           0
       )::NUMERIC(12, 2) AS remaining_receivable_gross
FROM external_invoices external
LEFT JOIN external_invoice_patient_invoice_allocations allocation
       ON allocation.external_invoice_id = external.id
LEFT JOIN invoices patient_invoice
       ON patient_invoice.id = allocation.patient_invoice_id
GROUP BY external.id, external.patient_receivable_gross;

COMMENT ON TABLE external_invoice_patient_invoice_allocations IS
    'Append-only reconciliation journal linking supplier/clinic receivables to patient invoices.';

COMMENT ON COLUMN external_invoice_patient_invoice_allocations.amount_gross IS
    'Source patient receivable transferred to the patient invoice; this is not the marked-up invoice line gross.';
