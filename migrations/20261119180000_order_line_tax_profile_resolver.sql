-- Owner decision 2026-11-19 (qa-fix-113): every order position carries its
-- tax profile, whichever path creates it (service form, lead wizard, order
-- wizard, completed appointments, interpreter reports, service groups,
-- amendments, repeat orders). The staff paths resolve and check the profile
-- in the server (422 on a mismatch); this INSERT trigger fills it for the
-- automatic paths with the same order: the catalogue item's profile (a
-- line priced by a legacy price version too), the one profile of the line's
-- rate. A
-- pass-through cost always carries «Durchlaufender Posten 0 %» at 0 %.
--
-- It runs on INSERT only: updates of delivered, approved or invoiced lines
-- (status changes, the legacy pass-throughs left by 20261119120000) keep the
-- terms they were billed on. Named to fire after `inherit_order_line_tariff`
-- and before `set_order_leistung_catalog_snapshot` (BEFORE triggers fire in
-- name order), so the snapshot takes the resolved rate.

CREATE OR REPLACE FUNCTION resolve_order_line_tax_profile()
RETURNS TRIGGER AS $$
DECLARE
    resolved_id UUID;
    line_rate NUMERIC := ROUND(COALESCE(NEW.vat_rate, 0), 2);
BEGIN
    IF NEW.is_cost_passthrough THEN
        IF NEW.tax_profile_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM tax_profiles
            WHERE id = NEW.tax_profile_id AND vat_category = 'pass_through'
        ) THEN
            SELECT id INTO resolved_id
            FROM tax_profiles
            WHERE profile_key = 'pass_through_0' AND is_active;
            NEW.tax_profile_id := resolved_id;
        END IF;
        IF NEW.tax_profile_id IS NOT NULL THEN
            NEW.vat_source := 'tax_profile';
        END IF;
        NEW.vat_rate := 0;
        RETURN NEW;
    END IF;

    IF NEW.tax_profile_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.agency_service_id IS NOT NULL THEN
        SELECT profile.id INTO resolved_id
        FROM agency_service_catalog catalog
        JOIN tax_profiles profile ON profile.id = catalog.tax_profile_id
        WHERE catalog.id = NEW.agency_service_id
          AND profile.vat_category <> 'pass_through'
          AND ROUND(profile.vat_rate, 2) = line_rate;
    END IF;

    IF resolved_id IS NULL THEN
        SELECT CASE WHEN COUNT(*) = 1 THEN MIN(profile.id::TEXT)::UUID END
        INTO resolved_id
        FROM tax_profiles profile
        WHERE profile.is_active
          AND profile.vat_category <> 'pass_through'
          AND profile.valid_from <= CURRENT_DATE
          AND (profile.valid_to IS NULL OR profile.valid_to >= CURRENT_DATE)
          AND ROUND(profile.vat_rate, 2) = line_rate;
    END IF;

    IF resolved_id IS NOT NULL THEN
        NEW.tax_profile_id := resolved_id;
        NEW.vat_source := 'tax_profile';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS resolve_order_line_tax_profile ON order_leistungen;
CREATE TRIGGER resolve_order_line_tax_profile
    BEFORE INSERT ON order_leistungen
    FOR EACH ROW
    EXECUTE FUNCTION resolve_order_line_tax_profile();

-- Positions still without a profile (e.g. «Organisation der Behandlung»
-- priced by a legacy price version, QA2 tester C) take the catalogue item's
-- or the one profile of their rate, only where that rate is the
-- line's rate: no stored amount changes. Pass-throughs stored with their
-- purchase VAT and 0 % lines that are neither § 4 Nr. 14 nor exempt by their
-- catalogue item stay without a profile (listed for review in the report).
UPDATE order_leistungen line
SET tax_profile_id = resolved.profile_id,
    vat_source = 'tax_profile'
FROM (
    SELECT candidate.id,
           COALESCE(
               (SELECT profile.id
                FROM agency_service_catalog catalog
                JOIN tax_profiles profile ON profile.id = catalog.tax_profile_id
                WHERE catalog.id = candidate.agency_service_id
                  AND profile.vat_category <> 'pass_through'
                  AND ROUND(profile.vat_rate, 2) = ROUND(candidate.vat_rate, 2)),
               (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(profile.id::TEXT)::UUID END
                FROM tax_profiles profile
                WHERE profile.is_active
                  AND profile.vat_category <> 'pass_through'
                  AND ROUND(profile.vat_rate, 2) = ROUND(candidate.vat_rate, 2))
           ) AS profile_id
    FROM order_leistungen candidate
    WHERE candidate.tax_profile_id IS NULL
      AND NOT candidate.is_cost_passthrough
) resolved
WHERE line.id = resolved.id
  AND resolved.profile_id IS NOT NULL;

-- The delivery facts of a final invoice carry the position's tax profile:
-- its lines outside the estimate bill that profile's rate and category.
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
    LEFT JOIN tax_profiles profile ON profile.id = service.tax_profile_id
    WHERE service.order_id = target_order_id
      AND service.status <> 'cancelled'
$$;
