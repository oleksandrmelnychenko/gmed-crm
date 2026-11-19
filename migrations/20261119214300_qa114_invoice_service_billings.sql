-- QA3 A S2-2 / D S2-1 / C S3-13 (qa-fix-114): a service billed outside the
-- estimate (a line «final_order_service» on a final or, since now, an
-- interim invoice) has no quote line allocation. The order line showed
-- «Счёт не выставлен 0/n» and the order economics counted its revenue as
-- not assigned. One reader of what invoices bill per order service:
--
-- * quote line allocations (estimate lines);
-- * invoice lines that bill a service outside the estimate (final, interim,
--   termination settlement), by their invoice line index;
-- * the negative line of a final crediting a quantity billed earlier and
--   never delivered (QA3 C S1-1), by its invoice line index.
CREATE OR REPLACE VIEW invoice_service_billings AS
    SELECT allocation.invoice_id,
           invoice.order_id,
           allocation.order_leistung_id,
           allocation.quote_id,
           allocation.quote_line_index,
           NULL::INTEGER AS invoice_line_index,
           allocation.quantity,
           allocation.amount_net_snapshot AS amount_net,
           allocation.amount_vat_snapshot AS amount_vat,
           allocation.amount_gross_snapshot AS amount_gross
    FROM invoice_order_line_allocations allocation
    JOIN invoices invoice ON invoice.id = allocation.invoice_id
    WHERE allocation.order_leistung_id IS NOT NULL
    UNION ALL
    SELECT invoice.id,
           invoice.order_id,
           -- Cast only a well-formed id: the planner may evaluate this
           -- before the WHERE below.
           CASE WHEN COALESCE(CASE WHEN line.value ->> 'source' = 'final_not_delivered_credit'
                                   THEN line.value ->> 'credited_order_leistung_id'
                                   ELSE line.value ->> 'source_order_leistung_id' END, '')
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (CASE WHEN line.value ->> 'source' = 'final_not_delivered_credit'
                           THEN line.value ->> 'credited_order_leistung_id'
                           ELSE line.value ->> 'source_order_leistung_id' END)::UUID
           END,
           invoice.quote_id,
           NULL::INTEGER,
           (line.position - 1)::INTEGER,
           COALESCE(NULLIF(line.value ->> 'quantity', '')::NUMERIC, 0),
           COALESCE(NULLIF(line.value ->> 'line_net', '')::NUMERIC, 0),
           COALESCE(NULLIF(line.value ->> 'line_vat', '')::NUMERIC, 0),
           COALESCE(NULLIF(line.value ->> 'line_gross', '')::NUMERIC, 0)
    FROM invoices invoice
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(invoice.line_items) = 'array'
             THEN invoice.line_items ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS line(value, position)
    WHERE (
            line.value ->> 'source' IN ('final_order_service', 'termination_order_service')
            AND COALESCE(line.value ->> 'source_order_leistung_id', '')
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
       OR (
            line.value ->> 'source' = 'final_not_delivered_credit'
            AND COALESCE(line.value ->> 'credited_order_leistung_id', '')
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          );

COMMENT ON VIEW invoice_service_billings IS
    'What invoices bill per order service: quote line allocations and invoice lines outside the estimate (by invoice line index), credits of never delivered quantities negative.';

-- Base: 20261031115200 (lines credited in full left out). A refreshed quote
-- (a new KV/EA version of an order billed in part) lists
-- services an interim already billed outside the estimate: their quantity
-- counts as invoiced for the quote line of the same service.
CREATE OR REPLACE FUNCTION quote_line_invoiced_quantities(target_quote_id UUID)
RETURNS TABLE (quote_line_index INTEGER, quantity NUMERIC)
LANGUAGE sql
STABLE
AS $$
    SELECT line.quote_line_index,
           (COALESCE((
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
           ), 0)
           + COALESCE((
               SELECT SUM(billing.quantity)
               FROM invoice_service_billings billing
               JOIN invoices invoice ON invoice.id = billing.invoice_id
               WHERE invoice.status <> 'cancelled'
                 AND billing.order_id = (SELECT order_id FROM quotes WHERE id = target_quote_id)
                 AND billing.quote_line_index IS NULL
                 AND billing.quantity > 0
                 AND line.order_leistung_id IS NOT NULL
                 AND billing.order_leistung_id = line.order_leistung_id
                 AND (invoice.total_gross <= 0 OR invoice.credited_amount < invoice.total_gross)
           ), 0))::NUMERIC AS quantity
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
