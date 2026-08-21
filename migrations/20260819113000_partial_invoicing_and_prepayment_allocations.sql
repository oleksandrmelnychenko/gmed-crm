-- Keep invoiced quantities and advance applications explicit instead of deriving
-- financial history from mutable quote/order state.

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS prepayment_applied_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_prepayment_applied_amount_nonnegative;

ALTER TABLE invoices
    ADD CONSTRAINT invoices_prepayment_applied_amount_nonnegative
    CHECK (prepayment_applied_amount >= 0);

CREATE TABLE IF NOT EXISTS invoice_order_line_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
    quote_line_index INTEGER NOT NULL CHECK (quote_line_index >= 0),
    order_leistung_id UUID REFERENCES order_leistungen(id) ON DELETE RESTRICT,
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    description_snapshot TEXT NOT NULL,
    unit_price_net_snapshot NUMERIC(12, 2) NOT NULL CHECK (unit_price_net_snapshot >= 0),
    vat_rate_snapshot NUMERIC(5, 2) NOT NULL CHECK (vat_rate_snapshot >= 0),
    amount_net_snapshot NUMERIC(12, 2) NOT NULL CHECK (amount_net_snapshot >= 0),
    amount_vat_snapshot NUMERIC(12, 2) NOT NULL CHECK (amount_vat_snapshot >= 0),
    amount_gross_snapshot NUMERIC(12, 2) NOT NULL CHECK (amount_gross_snapshot >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (invoice_id, quote_line_index)
);

CREATE INDEX IF NOT EXISTS idx_invoice_order_line_allocations_quote_line
    ON invoice_order_line_allocations(quote_id, quote_line_index);

CREATE INDEX IF NOT EXISTS idx_invoice_order_line_allocations_order_service
    ON invoice_order_line_allocations(order_leistung_id)
    WHERE order_leistung_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_invoice_order_line_allocation()
RETURNS trigger AS $$
DECLARE
    invoice_quote_id UUID;
    invoice_type_value TEXT;
    invoice_status_value TEXT;
    quote_items JSONB;
    quoted_quantity NUMERIC;
    already_allocated NUMERIC;
BEGIN
    SELECT quote_id, invoice_type, status
    INTO invoice_quote_id, invoice_type_value, invoice_status_value
    FROM invoices
    WHERE id = NEW.invoice_id;

    IF invoice_quote_id IS NULL OR invoice_quote_id <> NEW.quote_id THEN
        RAISE EXCEPTION 'Invoice line allocation must reference its invoice quote';
    END IF;
    IF invoice_type_value = 'advance' OR invoice_status_value = 'cancelled' THEN
        RAISE EXCEPTION 'Only active settlement invoices consume quote quantities';
    END IF;

    SELECT line_items INTO quote_items
    FROM quotes
    WHERE id = NEW.quote_id
    FOR UPDATE;

    quoted_quantity := NULLIF(
        quote_items -> NEW.quote_line_index ->> 'quantity',
        ''
    )::NUMERIC;
    IF quoted_quantity IS NULL OR quoted_quantity <= 0 THEN
        RAISE EXCEPTION 'Quote line does not exist or has invalid quantity';
    END IF;

    SELECT COALESCE(SUM(allocation.quantity), 0)
    INTO already_allocated
    FROM invoice_order_line_allocations allocation
    JOIN invoices invoice ON invoice.id = allocation.invoice_id
    WHERE allocation.quote_id = NEW.quote_id
      AND allocation.quote_line_index = NEW.quote_line_index
      AND invoice.status <> 'cancelled'
      AND allocation.id <> NEW.id;

    IF already_allocated + NEW.quantity > quoted_quantity THEN
        RAISE EXCEPTION 'Invoice quantity exceeds remaining quote line quantity';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_invoice_order_line_allocation_trigger
    ON invoice_order_line_allocations;
CREATE TRIGGER validate_invoice_order_line_allocation_trigger
    BEFORE INSERT OR UPDATE ON invoice_order_line_allocations
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_order_line_allocation();

-- Backfill existing non-advance invoices so a deployment cannot re-invoice lines
-- that were already invoiced before this normalized allocation table existed.
INSERT INTO invoice_order_line_allocations (
    invoice_id,
    quote_id,
    quote_line_index,
    order_leistung_id,
    quantity,
    description_snapshot,
    unit_price_net_snapshot,
    vat_rate_snapshot,
    amount_net_snapshot,
    amount_vat_snapshot,
    amount_gross_snapshot
)
SELECT
    invoice.id,
    invoice.quote_id,
    (line.ordinality - 1)::INTEGER,
    CASE
        WHEN COALESCE(line.item->>'source_order_leistung_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (line.item->>'source_order_leistung_id')::UUID
        ELSE NULL
    END,
    GREATEST(COALESCE(NULLIF(line.item->>'quantity', '')::NUMERIC, 1), 0.01),
    COALESCE(NULLIF(line.item->>'description', ''), 'Invoice line'),
    GREATEST(COALESCE(NULLIF(line.item->>'unit_price', '')::NUMERIC, 0), 0),
    GREATEST(COALESCE(NULLIF(line.item->>'vat_rate', '')::NUMERIC, 0), 0),
    GREATEST(COALESCE(NULLIF(line.item->>'line_net', '')::NUMERIC, 0), 0),
    GREATEST(COALESCE(NULLIF(line.item->>'line_vat', '')::NUMERIC, 0), 0),
    GREATEST(COALESCE(NULLIF(line.item->>'line_gross', '')::NUMERIC, 0), 0)
FROM invoices invoice
CROSS JOIN LATERAL jsonb_array_elements(invoice.line_items) WITH ORDINALITY AS line(item, ordinality)
WHERE invoice.quote_id IS NOT NULL
  AND invoice.invoice_type <> 'advance'
  AND invoice.status <> 'cancelled'
  AND COALESCE(line.item->>'source', '') <> 'service_package_overage'
ON CONFLICT (invoice_id, quote_line_index) DO NOTHING;

-- Multiple partial interim invoices are valid. Only one active final settlement is
-- allowed for a quote.
DROP INDEX IF EXISTS idx_invoices_quote_active_settlement;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_quote_active_final
    ON invoices(quote_id)
    WHERE quote_id IS NOT NULL
      AND invoice_type = 'final'
      AND status <> 'cancelled';

CREATE TABLE IF NOT EXISTS invoice_prepayment_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    advance_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    target_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (advance_invoice_id <> target_invoice_id),
    UNIQUE (advance_invoice_id, target_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_prepayment_allocations_target
    ON invoice_prepayment_allocations(target_invoice_id, created_at);

CREATE INDEX IF NOT EXISTS idx_invoice_prepayment_allocations_advance
    ON invoice_prepayment_allocations(advance_invoice_id, created_at);

CREATE OR REPLACE FUNCTION validate_invoice_prepayment_allocation()
RETURNS trigger AS $$
DECLARE
    source_invoice invoices%ROWTYPE;
    target_invoice invoices%ROWTYPE;
    source_allocated NUMERIC;
    target_allocated NUMERIC;
BEGIN
    SELECT * INTO source_invoice
    FROM invoices
    WHERE id = NEW.advance_invoice_id
    FOR UPDATE;

    SELECT * INTO target_invoice
    FROM invoices
    WHERE id = NEW.target_invoice_id
    FOR UPDATE;

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
    WHERE advance_invoice_id = NEW.advance_invoice_id
      AND id <> NEW.id;

    IF source_allocated + NEW.amount_gross > source_invoice.paid_amount THEN
        RAISE EXCEPTION 'Prepayment allocation exceeds paid advance balance';
    END IF;

    SELECT COALESCE(SUM(amount_gross), 0) INTO target_allocated
    FROM invoice_prepayment_allocations
    WHERE target_invoice_id = NEW.target_invoice_id
      AND id <> NEW.id;

    IF target_allocated + NEW.amount_gross + target_invoice.paid_amount > target_invoice.total_gross THEN
        RAISE EXCEPTION 'Prepayment allocation exceeds target invoice balance';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_invoice_prepayment_allocation_trigger
    ON invoice_prepayment_allocations;
CREATE TRIGGER validate_invoice_prepayment_allocation_trigger
    BEFORE INSERT OR UPDATE ON invoice_prepayment_allocations
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_prepayment_allocation();

CREATE OR REPLACE FUNCTION refresh_invoice_prepayment_applied_amount()
RETURNS trigger AS $$
DECLARE
    affected_target UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected_target := OLD.target_invoice_id;
    ELSE
        affected_target := NEW.target_invoice_id;
    END IF;
    UPDATE invoices
    SET prepayment_applied_amount = COALESCE((
        SELECT SUM(amount_gross)
        FROM invoice_prepayment_allocations
        WHERE target_invoice_id = affected_target
    ), 0)
    WHERE id = affected_target;

    IF TG_OP = 'UPDATE' AND OLD.target_invoice_id <> NEW.target_invoice_id THEN
        UPDATE invoices
        SET prepayment_applied_amount = COALESCE((
            SELECT SUM(amount_gross)
            FROM invoice_prepayment_allocations
            WHERE target_invoice_id = OLD.target_invoice_id
        ), 0)
        WHERE id = OLD.target_invoice_id;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refresh_invoice_prepayment_applied_amount_trigger
    ON invoice_prepayment_allocations;
CREATE TRIGGER refresh_invoice_prepayment_applied_amount_trigger
    AFTER INSERT OR UPDATE OR DELETE ON invoice_prepayment_allocations
    FOR EACH ROW
    EXECUTE FUNCTION refresh_invoice_prepayment_applied_amount();
