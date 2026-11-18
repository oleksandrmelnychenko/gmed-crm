-- Owner 2026-11-18: a discount («Скидка» / «Rabatt») in percent per order
-- position. The documents print it under the position, and the VAT is taken
-- from the discounted amount:
--   list net = round(quantity × unit price, 2)
--   discount = round(list net × discount % / 100, 2)
--   net      = list net − discount
--   VAT      = round(net × rate / 100, 2), none for a pass-through cost
-- (`money::line_amounts`, `moneyLineAmounts`). ROUND(numeric) rounds half away
-- from zero like the server and the frontend.
--
-- A pass-through cost is billed at cost and carries no discount.

ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE order_leistungen
    DROP CONSTRAINT IF EXISTS order_leistungen_discount_percent_range;
ALTER TABLE order_leistungen
    ADD CONSTRAINT order_leistungen_discount_percent_range
    CHECK (discount_percent >= 0 AND discount_percent <= 100);

ALTER TABLE order_leistungen
    DROP CONSTRAINT IF EXISTS order_leistungen_passthrough_without_discount;
ALTER TABLE order_leistungen
    ADD CONSTRAINT order_leistungen_passthrough_without_discount
    CHECK (NOT is_cost_passthrough OR discount_percent = 0);

-- What an invoice bills of a quote line: the discount it was priced with, so
-- a credit note of part of it is priced the same way. The amount snapshots
-- already are the discounted amounts.
ALTER TABLE invoice_order_line_allocations
    ADD COLUMN IF NOT EXISTS discount_percent_snapshot NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE invoice_order_line_allocations
    DROP CONSTRAINT IF EXISTS invoice_order_line_allocations_discount_range;
ALTER TABLE invoice_order_line_allocations
    ADD CONSTRAINT invoice_order_line_allocations_discount_range
    CHECK (discount_percent_snapshot >= 0 AND discount_percent_snapshot <= 100);

-- The net of one order line after its discount.
CREATE OR REPLACE FUNCTION order_line_net(
    quantity NUMERIC,
    unit_price NUMERIC,
    discount_percent NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ROUND(quantity * unit_price, 2)
           - CASE
                 WHEN COALESCE(discount_percent, 0) <= 0 THEN 0
                 WHEN discount_percent >= 100 THEN ROUND(quantity * unit_price, 2)
                 ELSE ROUND(ROUND(quantity * unit_price, 2) * discount_percent / 100, 2)
             END
$$;

COMMENT ON FUNCTION order_line_net(NUMERIC, NUMERIC, NUMERIC) IS
    'Net of an order line: round(quantity x unit price) minus round(that x discount % / 100).';

CREATE OR REPLACE FUNCTION order_service_total_gross(target_order_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
               WHEN COUNT(*) = 0 THEN NULL
               ELSE COALESCE(SUM(line.net + line.vat) FILTER (WHERE line.status <> 'cancelled'), 0)
           END
    FROM (
        SELECT service.status,
               order_line_net(service.quantity, service.unit_price_snapshot, service.discount_percent) AS net,
               CASE
                   WHEN service.is_cost_passthrough THEN 0
                   ELSE ROUND(
                       order_line_net(service.quantity, service.unit_price_snapshot, service.discount_percent)
                           * service.vat_rate_snapshot / 100,
                       2
                   )
               END AS vat
        FROM order_leistungen service
        WHERE service.order_id = target_order_id
    ) line
$$;

COMMENT ON FUNCTION order_service_total_gross(UUID) IS
    'Gross total of the order services that are not cancelled, after line discounts (NULL without any service line).';

-- The signed terms name a line's discount only where it has one, so the terms
-- of every order signed before discounts existed stay what they were.
CREATE OR REPLACE FUNCTION order_client_terms(target UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'date_from', o.date_from,
        'date_to', o.date_to,
        'currency', UPPER(o.currency),
        'total_gross', COALESCE(order_service_total_gross(o.id), o.total_estimated),
        'prepayment_required', o.prepayment_required,
        'prepayment_amount', o.prepayment_amount,
        'prepayment_due_at', o.prepayment_due_at,
        'lines', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', line.id,
                    'description', line.description,
                    'quantity', line.quantity,
                    'unit_price', line.unit_price_snapshot,
                    'vat_rate', line.vat_rate_snapshot,
                    'is_cost_passthrough', line.is_cost_passthrough
                ) || CASE
                    WHEN line.discount_percent > 0
                        THEN jsonb_build_object('discount_percent', line.discount_percent)
                    ELSE '{}'::jsonb
                END
                ORDER BY line.created_at, line.id
            )
            FROM order_leistungen line
            WHERE line.order_id = o.id
              AND line.status <> 'cancelled'
        ), '[]'::jsonb)
    ) || CASE
        WHEN o.intake_state = 'draft' AND EXISTS (
            SELECT 1 FROM leads l
            WHERE l.id = o.source_lead_id AND l.repeat_patient_id IS NOT NULL
        ) THEN jsonb_build_object(
            'needs_description', o.needs_description,
            'contract_id', o.contract_id
        )
        ELSE '{}'::jsonb
    END
    FROM orders o
    WHERE o.id = target
$$;

COMMENT ON FUNCTION order_client_terms(UUID) IS
    'What the client signs in an order: not cancelled services (with their discount), programme period, prepayment and gross total; on a repeat draft also the purpose and the contract its documents print.';

-- A repeat order's documents print the discount: a line with one names it, so
-- a changed discount makes the documents outdated like a changed price.
CREATE OR REPLACE FUNCTION repeat_order_document_context(target UUID) RETURNS JSONB AS $$
    SELECT jsonb_build_object('kind','repeat-order-v2','order_id',o.id,
        'date_from',o.date_from,'date_to',o.date_to,'contract_id',o.contract_id,
        'needs_description',o.needs_description,'currency',o.currency,
        'total_estimated',o.total_estimated,'prepayment_required',o.prepayment_required,
        'prepayment_amount',o.prepayment_amount,'prepayment_due_at',o.prepayment_due_at,
        'specialties',l.requested_specialties,
        'specialty_names',COALESCE((
            SELECT jsonb_agg(COALESCE(s.name_de, selected.value) ORDER BY selected.ordinality)
            FROM jsonb_array_elements_text(COALESCE(l.requested_specialties, '[]'::jsonb))
                WITH ORDINALITY AS selected(value, ordinality)
            LEFT JOIN medical_specializations s
                ON s.code = selected.value AND s.deleted_at IS NULL
        ), '[]'::jsonb),
        'contract_effective_date',l.wizard_state->'contract_effective_date',
        'cost_threshold',l.wizard_state->'cost_threshold',
        'patient',jsonb_build_object('id',p.id,'first_name',p.first_name,'last_name',p.last_name,
            'birth_date',p.birth_date,'address_street',p.address_street,'address_city',p.address_city,
            'address_zip',p.address_zip,'address_country',p.address_country,
            'insurance_provider',p.insurance_provider,'insurance_number',p.insurance_number),
        'lead',jsonb_build_object('first_name',l.first_name,'last_name',l.last_name,'date_of_birth',l.date_of_birth,
            'street_address',l.street_address,'city',l.city,'zip_code',l.zip_code,'country',l.country,
            'insurance_provider',l.insurance_provider,'insurance_number',l.insurance_number),
        'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'description',s.description,
            'quantity',s.quantity::text,'unit_price',s.unit_price_snapshot::text,'vat_rate',s.vat_rate_snapshot::text,
            'agency_service_id',s.agency_service_id,'unit_label',s.agency_service_unit_label_snapshot,
            'note',s.agency_service_description_snapshot,'description_items',s.agency_service_description_items_snapshot)
            || CASE WHEN s.is_cost_passthrough THEN jsonb_build_object('is_cost_passthrough',true) ELSE '{}'::jsonb END
            || CASE WHEN s.discount_percent > 0 THEN jsonb_build_object('discount_percent',s.discount_percent::text) ELSE '{}'::jsonb END
            ORDER BY s.id) FROM order_leistungen s WHERE s.order_id=o.id AND s.status <> 'cancelled'),'[]'::jsonb))
    FROM orders o JOIN leads l ON l.id=o.source_lead_id
    JOIN patients p ON p.id=COALESCE(l.repeat_patient_id,l.prospect_patient_id)
    WHERE o.id=target AND p.lifecycle_status IN ('active','inactive')
$$ LANGUAGE sql STABLE;

-- A changed discount changes the service content like a changed price.
CREATE OR REPLACE FUNCTION invalidate_repeat_service_signatures() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND
        ROW(NEW.description,NEW.quantity,NEW.unit_price_snapshot,NEW.vat_rate_snapshot,NEW.currency,
            NEW.agency_service_description_snapshot,NEW.agency_service_description_items_snapshot,NEW.agency_service_unit_label_snapshot,
            NEW.discount_percent)
        IS NOT DISTINCT FROM
        ROW(OLD.description,OLD.quantity,OLD.unit_price_snapshot,OLD.vat_rate_snapshot,OLD.currency,
            OLD.agency_service_description_snapshot,OLD.agency_service_description_items_snapshot,OLD.agency_service_unit_label_snapshot,
            OLD.discount_percent)
    THEN RETURN NEW; END IF;
    UPDATE orders o SET signed_patient=false,signed_agency=false,signed_at=NULL,
        signed_patient_at=NULL,signed_agency_at=NULL
    WHERE o.id=COALESCE(NEW.order_id,OLD.order_id) AND o.intake_state='draft'
      AND EXISTS(SELECT 1 FROM leads l WHERE l.id=o.source_lead_id AND l.repeat_patient_id IS NOT NULL);
    RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;

-- The final invoice proposal prices delivered quantities with the line's
-- discount.
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
               'discount_percent', service.discount_percent,
               'is_cost_passthrough', service.is_cost_passthrough,
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
               -- Invoices that billed it and are credited in full: billable again.
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
    WHERE service.order_id = target_order_id
      AND service.status <> 'cancelled'
$$;

-- Owner 2026-11-18: the discount belongs to the tariff chosen for a service
-- in the order (price version + discount). A line the system adds later for
-- a service the order already has (a completed appointment, an interpreter
-- report) is priced with that tariff (service groups keep their own group
-- price),
-- never with the catalogue's current price. Lines staff add or change by
-- hand keep what they send (the order screens default to the order's tariff).
-- Named to fire before `set_order_leistung_catalog_snapshot` (BEFORE triggers
-- fire in name order), which then snapshots the inherited price.
CREATE OR REPLACE FUNCTION inherit_order_line_tariff()
RETURNS TRIGGER AS $$
DECLARE
    tariff RECORD;
BEGIN
    IF NEW.agency_service_id IS NULL
       OR NEW.is_cost_passthrough
       OR (NEW.source_medical_appointment_id IS NULL
           AND NEW.source_interpreter_report_id IS NULL) THEN
        RETURN NEW;
    END IF;
    SELECT line.unit_price_snapshot, line.vat_rate_snapshot, line.currency,
           line.agency_service_price_version_id, line.tax_profile_id,
           line.vat_source, line.discount_percent
    INTO tariff
    FROM order_leistungen line
    WHERE line.order_id = NEW.order_id
      AND line.agency_service_id = NEW.agency_service_id
      AND line.status <> 'cancelled'
      AND NOT line.is_cost_passthrough
      AND line.id IS DISTINCT FROM NEW.id
      AND UPPER(line.currency) = UPPER(NEW.currency)
    ORDER BY line.created_at, line.id
    LIMIT 1;
    IF FOUND THEN
        NEW.unit_price := tariff.unit_price_snapshot;
        NEW.vat_rate := tariff.vat_rate_snapshot;
        NEW.agency_service_price_version_id := tariff.agency_service_price_version_id;
        NEW.tax_profile_id := tariff.tax_profile_id;
        NEW.vat_source := tariff.vat_source;
        NEW.discount_percent := tariff.discount_percent;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inherit_order_line_tariff ON order_leistungen;
CREATE TRIGGER inherit_order_line_tariff
    BEFORE INSERT ON order_leistungen
    FOR EACH ROW
    EXECUTE FUNCTION inherit_order_line_tariff();
