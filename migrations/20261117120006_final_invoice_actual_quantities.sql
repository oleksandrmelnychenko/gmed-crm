-- A final invoice bills what was actually delivered (owner 2026-11-17): an
-- estimate line planned with 3 interpreter hours is billed with 5 or with 2,
-- a line not delivered is left out. Advance and interim invoices keep the
-- quoted quantity as their limit. Issued invoices and allocations are not
-- rewritten.

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

    -- The final invoice bills the delivered quantity, above or below the
    -- quote.
    IF invoice_type_value = 'final' THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(allocation.quantity), 0)
    INTO already_allocated
    FROM invoice_order_line_allocations allocation
    JOIN invoices invoice ON invoice.id = allocation.invoice_id
    WHERE invoice.status <> 'cancelled'
      AND allocation.id <> NEW.id
      AND NOT invoice_quote_line_credited(invoice.id, allocation.quote_line_index)
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

-- Whether an active final invoice of the quote settles the line: the final
-- closes every line, billed or left out, except a line whose allocation on it
-- a credit note covers in full (that quantity can be billed again, R3 BUG-2).
-- `excluded_invoice` is a draft being rebuilt.
CREATE OR REPLACE FUNCTION quote_line_closed_by_final(
    target_quote_id UUID,
    target_line INTEGER,
    excluded_invoice UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM invoices final_invoice
        WHERE final_invoice.quote_id = target_quote_id
          AND final_invoice.invoice_type = 'final'
          AND final_invoice.status <> 'cancelled'
          AND (final_invoice.total_gross <= 0
               OR final_invoice.credited_amount < final_invoice.total_gross)
          AND (excluded_invoice IS NULL OR final_invoice.id <> excluded_invoice)
          AND NOT (
              EXISTS (
                  SELECT 1
                  FROM invoice_order_line_allocations allocation
                  WHERE allocation.invoice_id = final_invoice.id
                    AND allocation.quote_line_index = target_line
              )
              AND invoice_quote_line_credited(final_invoice.id, target_line)
          )
    )
$$;

COMMENT ON FUNCTION quote_line_closed_by_final(UUID, INTEGER, UUID) IS
    'Whether an active final invoice of the quote settles the quote line (billed with any quantity or left out); a line credited in full on it stays open.';

CREATE OR REPLACE FUNCTION quote_final_closed_lines(target_quote_id UUID)
RETURNS INTEGER[]
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(array_agg(line.index::INTEGER ORDER BY line.index), ARRAY[]::INTEGER[])
    FROM quotes quote
    CROSS JOIN LATERAL generate_series(
        0,
        jsonb_array_length(CASE WHEN jsonb_typeof(quote.line_items) = 'array'
                                THEN quote.line_items ELSE '[]'::jsonb END) - 1
    ) AS line(index)
    WHERE quote.id = target_quote_id
      AND quote_line_closed_by_final(quote.id, line.index::INTEGER)
$$;

COMMENT ON FUNCTION quote_final_closed_lines(UUID) IS
    'Indexes of the quote lines an active final invoice settles (quote_line_closed_by_final).';

-- What the final invoice proposal reads per order service: its delivery
-- state, terms and the active settlement invoices that bill it (by a quote
-- line allocation or a line naming the service).
CREATE OR REPLACE FUNCTION order_service_delivery_facts(target_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', service.id,
               'status', service.status,
               'quantity', service.quantity,
               'agency_service_id', service.agency_service_id,
               'description', service.description,
               'name', COALESCE(NULLIF(BTRIM(service.agency_service_name_snapshot), ''), service.description),
               'unit', service.agency_service_unit_label_snapshot,
               'unit_price', COALESCE(service.unit_price_snapshot, service.unit_price),
               'vat_rate', COALESCE(service.vat_rate_snapshot, service.vat_rate),
               'is_cost_passthrough', service.is_cost_passthrough,
               'billing_invoice_ids', COALESCE((
                   SELECT jsonb_agg(DISTINCT invoice.id)
                   FROM invoices invoice
                   WHERE invoice.order_id = service.order_id
                     AND invoice.status <> 'cancelled'
                     AND invoice.invoice_type <> 'advance'
                     AND (invoice.total_gross <= 0 OR invoice.credited_amount < invoice.total_gross)
                     AND (
                         EXISTS (
                             SELECT 1 FROM invoice_order_line_allocations allocation
                             WHERE allocation.invoice_id = invoice.id
                               AND allocation.order_leistung_id = service.id
                         )
                         OR invoice.line_items @> jsonb_build_array(
                             jsonb_build_object('source_order_leistung_id', service.id::text)
                         )
                     )
               ), '[]'::jsonb)
           ) ORDER BY service.created_at, service.id), '[]'::jsonb)
    FROM order_leistungen service
    WHERE service.order_id = target_order_id
      AND service.status <> 'cancelled'
$$;

COMMENT ON FUNCTION order_service_delivery_facts(UUID) IS
    'Delivery state, terms and billing invoices of the order''s services that are not cancelled; read by the final invoice proposal.';
