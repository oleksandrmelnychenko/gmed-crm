-- A new quote supersedes the order's older open quotes so that the same
-- service is not billed twice (20260925170000_quote_superseded_status.sql).
-- A service that was only partly invoiced from the old quote is not yet
-- 'invoiced', so the new quote lists it again with its full quantity. Invoiced
-- quantities were counted per quote line only, which let the new quote bill
-- the already invoiced part a second time (10 h delivered, 4 h invoiced from
-- the old quote, 10 h more from the new one).
--
-- Invoiced quantities of a quote line now also include what other quotes of
-- the order invoiced for the same order service. Existing allocations and
-- invoices are not rewritten; the rule applies to new allocations.

CREATE OR REPLACE FUNCTION quote_line_invoiced_quantities(target_quote_id UUID)
RETURNS TABLE (quote_line_index INTEGER, quantity NUMERIC)
LANGUAGE sql
STABLE
AS $$
    SELECT line.quote_line_index,
           COALESCE((
               SELECT SUM(allocation.quantity)
               FROM invoice_order_line_allocations allocation
               JOIN invoices invoice ON invoice.id = allocation.invoice_id
               WHERE invoice.status <> 'cancelled'
                 AND (
                     (allocation.quote_id = target_quote_id
                      AND allocation.quote_line_index = line.quote_line_index)
                     OR (allocation.quote_id <> target_quote_id
                         AND line.order_leistung_id IS NOT NULL
                         AND allocation.order_leistung_id = line.order_leistung_id)
                 )
           ), 0)::NUMERIC AS quantity
    FROM (
        SELECT (item.ordinality - 1)::INTEGER AS quote_line_index,
               CASE
                   WHEN COALESCE(item.value ->> 'source_order_leistung_id', '')
                        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN (item.value ->> 'source_order_leistung_id')::UUID
               END AS order_leistung_id
        FROM quotes quote
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(quote.line_items) = 'array'
                 THEN quote.line_items ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS item(value, ordinality)
        WHERE quote.id = target_quote_id
    ) line
$$;

COMMENT ON FUNCTION quote_line_invoiced_quantities(UUID) IS
    'Invoiced quantity per quote line: allocations of the line itself plus allocations of the same order service from other quotes of the order (non-cancelled invoices).';

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

    -- Serialises allocations of one order service coming from different
    -- quotes; the quote lock above only covers allocations of this quote.
    IF NEW.order_leistung_id IS NOT NULL THEN
        PERFORM 1 FROM order_leistungen WHERE id = NEW.order_leistung_id FOR UPDATE;
    END IF;

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
    WHERE invoice.status <> 'cancelled'
      AND allocation.id <> NEW.id
      AND (
          (allocation.quote_id = NEW.quote_id
           AND allocation.quote_line_index = NEW.quote_line_index)
          OR (NEW.order_leistung_id IS NOT NULL
              AND allocation.quote_id <> NEW.quote_id
              AND allocation.order_leistung_id = NEW.order_leistung_id)
      );

    IF already_allocated + NEW.quantity > quoted_quantity THEN
        RAISE EXCEPTION 'Invoice quantity exceeds remaining quote line quantity';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
