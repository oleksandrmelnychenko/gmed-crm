-- QA 2026-10-31 (R3-7): an invoice whose line is credited in full no longer
-- bills the service (doc 3.3), but the invoiced quantity of the quote line still
-- counted it, so the service could not be billed again: "no remaining
-- quantities". A credited line now gives its quantity back, and a fully
-- credited final invoice no longer occupies the quote's one final invoice.
-- Issued invoices and allocations are not rewritten.

-- Same reading as the billing state of an order service (`orders.rs`, QA D3-07):
-- the whole invoice credited, the line by a credit note with lines, or its
-- pro-rata share of a credit note without lines.
CREATE OR REPLACE FUNCTION invoice_quote_line_credited(
    target_invoice UUID,
    target_line INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE((
        SELECT (invoice.total_gross > 0 AND invoice.credited_amount >= invoice.total_gross)
            OR (
                allocated.gross > 0
                AND line_credit.gross
                    + CASE WHEN invoice.total_gross > 0
                           THEN allocated.gross * legacy_credit.gross / invoice.total_gross
                           ELSE 0 END
                    >= allocated.gross
            )
        FROM invoices invoice
        CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(allocation.amount_gross_snapshot), 0) AS gross
            FROM invoice_order_line_allocations allocation
            WHERE allocation.invoice_id = invoice.id
              AND allocation.quote_line_index = target_line
        ) allocated
        CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(
                       CASE WHEN credit.transaction_type = 'credit_note' THEN 1 ELSE -1 END
                       * COALESCE(NULLIF(credited.value ->> 'line_gross', '')::NUMERIC, 0)
                   ), 0) AS gross
            FROM invoice_credit_note_transactions credit
            CROSS JOIN LATERAL jsonb_array_elements(credit.line_items) AS credited(value)
            WHERE credit.invoice_id = invoice.id
              AND credit.line_items IS NOT NULL
              AND jsonb_typeof(credit.line_items) = 'array'
              AND jsonb_typeof(invoice.line_items) = 'array'
              AND NULLIF(
                      invoice.line_items
                          -> ((credited.value ->> 'invoice_line_index')::INTEGER)
                          ->> 'quote_line_index',
                      ''
                  )::INTEGER = target_line
        ) line_credit
        CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(
                       CASE WHEN credit.transaction_type = 'credit_note'
                            THEN credit.amount_gross ELSE -credit.amount_gross END
                   ), 0) AS gross
            FROM invoice_credit_note_transactions credit
            WHERE credit.invoice_id = invoice.id
              AND credit.line_items IS NULL
        ) legacy_credit
        WHERE invoice.id = target_invoice
          AND invoice.released_at IS NOT NULL
    ), false)
$$;

COMMENT ON FUNCTION invoice_quote_line_credited(UUID, INTEGER) IS
    'Whether a released invoice no longer bills a quote line because credit notes cover it in full.';

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
                 AND NOT invoice_quote_line_credited(invoice.id, allocation.quote_line_index)
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
    'Invoiced quantity per quote line: allocations of the line itself plus allocations of the same order service from other quotes of the order (non-cancelled invoices, lines credited in full left out).';

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

DROP INDEX IF EXISTS idx_invoices_quote_active_final;
CREATE UNIQUE INDEX idx_invoices_quote_active_final
    ON invoices(quote_id)
    WHERE quote_id IS NOT NULL
      AND invoice_type = 'final'
      AND status <> 'cancelled'
      AND (total_gross <= 0 OR credited_amount < total_gross);
