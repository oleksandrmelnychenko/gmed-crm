-- QA3 C S1-1 (qa-fix-114): a planned line billed on an interim invoice was
-- set to `invoiced` at the release and the final invoice then read it as
-- delivered: «Voraussichtliche Auslagen» billed ahead stayed billed although
-- nothing was spent. The delivery facts now say whether delivery was really
-- recorded (delivered_at / approved_at), so the final settles what was
-- delivered against everything billed before and credits the rest.
CREATE OR REPLACE FUNCTION order_service_delivery_facts(target_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', service.id,
               'status', service.status,
               'delivery_recorded', (service.delivered_at IS NOT NULL
                                     OR service.approved_at IS NOT NULL),
               'quantity', service.quantity,
               'agency_service_id', service.agency_service_id,
               'description', service.description,
               'name', COALESCE(NULLIF(BTRIM(service.agency_service_name_snapshot), ''), service.description),
               'unit', service.agency_service_unit_label_snapshot,
               'unit_price', COALESCE(service.unit_price_snapshot, service.unit_price),
               'vat_rate', COALESCE(service.vat_rate_snapshot, service.vat_rate),
               'discount_percent', service.discount_percent,
               'is_cost_passthrough', service.is_cost_passthrough,
               'tax_profile_id', service.tax_profile_id,
               'vat_category', profile.vat_category,
               'tax_profile_vat_rate', profile.vat_rate,
               'waived', service.billing_waived_at IS NOT NULL,
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
               ), '[]'::jsonb),
               'credited_invoice_ids', COALESCE((
                   SELECT jsonb_agg(DISTINCT invoice.id)
                   FROM invoices invoice
                   WHERE invoice.order_id = service.order_id
                     AND invoice.status <> 'cancelled'
                     AND invoice.total_gross > 0
                     AND invoice.credited_amount >= invoice.total_gross
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
    LEFT JOIN tax_profiles profile ON profile.id = service.tax_profile_id
    WHERE service.order_id = target_order_id
      AND service.status <> 'cancelled'
$$;
