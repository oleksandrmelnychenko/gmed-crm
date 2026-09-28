-- An order service becomes `invoiced` when an invoice billing it is released,
-- not when a draft is prepared. A draft reserves the service (its quote-line
-- allocation or line counts against the quantity still to invoice) without
-- changing its status; cancelling the draft frees it.
--
-- Services that only drafts marked `invoiced` return to the stage they really
-- reached (approved, delivered or planned), the rule already used when an
-- invoice is cancelled. Services billed by a released invoice keep `invoiced`.

WITH billing AS (
    SELECT allocation.order_leistung_id AS service_id,
           invoice.released_at IS NOT NULL AS released
    FROM invoice_order_line_allocations allocation
    JOIN invoices invoice ON invoice.id = allocation.invoice_id
    WHERE allocation.order_leistung_id IS NOT NULL
      AND invoice.status <> 'cancelled'
    UNION ALL
    SELECT (item.value ->> 'source_order_leistung_id')::UUID,
           invoice.released_at IS NOT NULL
    FROM invoices invoice
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(invoice.line_items) = 'array'
             THEN invoice.line_items ELSE '[]'::jsonb END
    ) AS item(value)
    WHERE invoice.status <> 'cancelled'
      AND invoice.invoice_type <> 'advance'
      AND COALESCE(item.value ->> 'source_order_leistung_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), draft_only AS (
    SELECT service_id
    FROM billing
    GROUP BY service_id
    HAVING bool_or(NOT released) AND NOT bool_or(released)
)
UPDATE order_leistungen service
SET status = CASE
        WHEN service.approved_at IS NOT NULL OR service.approved_by IS NOT NULL THEN 'approved'
        WHEN service.delivered_at IS NOT NULL THEN 'delivered'
        ELSE 'planned'
    END
FROM draft_only
WHERE service.id = draft_only.service_id
  AND service.status = 'invoiced';
