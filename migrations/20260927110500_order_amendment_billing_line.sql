-- An approved order amount amendment (#10, 20260708160000) only raised
-- orders.total_estimated. It was never billed: the next quote recomputed the
-- total from the order services and silently dropped it, and the order page
-- showed three different totals.
--
-- Approval now adds a billable order service line ("Anpassung") with the
-- approved gross delta, so the next quote and its invoices include it. The
-- proposal records how the amount is taxed (a tax profile or a pass-through
-- cost); the line is linked back to its amendment. Amendments decided before
-- this change keep their history and carry no VAT treatment; an approved one
-- can still be billed later from the order page (explicit action, no backfill,
-- so nothing already billed by hand is billed twice).

ALTER TABLE order_amendments
    ADD COLUMN IF NOT EXISTS vat_treatment TEXT,
    ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS is_cost_passthrough BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS tax_profile_id UUID REFERENCES tax_profiles(id) ON DELETE SET NULL;

ALTER TABLE order_amendments
    DROP CONSTRAINT IF EXISTS order_amendments_vat_treatment_check,
    DROP CONSTRAINT IF EXISTS order_amendments_vat_consistent;

ALTER TABLE order_amendments
    ADD CONSTRAINT order_amendments_vat_treatment_check
        CHECK (vat_treatment IS NULL
               OR vat_treatment IN ('standard_vat', 'termin_fee_0', 'vat_exempt_0', 'cost_passthrough')),
    ADD CONSTRAINT order_amendments_vat_consistent
        CHECK (
            (vat_treatment IS NULL AND vat_rate IS NULL AND NOT is_cost_passthrough)
            OR (vat_treatment IS NOT NULL
                AND vat_rate BETWEEN 0 AND 100
                AND is_cost_passthrough = (vat_treatment = 'cost_passthrough')
                AND (NOT is_cost_passthrough OR vat_rate = 0))
        );

COMMENT ON COLUMN order_amendments.vat_treatment IS
    'How the amended amount is taxed: a tax profile key or cost_passthrough; NULL for amendments proposed before billing lines existed.';

ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS source_order_amendment_id UUID
        REFERENCES order_amendments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_leistungen_source_order_amendment
    ON order_leistungen(source_order_amendment_id)
    WHERE source_order_amendment_id IS NOT NULL;

COMMENT ON COLUMN order_leistungen.source_order_amendment_id IS
    'Approved order amount amendment this billing line was created from.';

-- The order total shown everywhere (order header, finance card, services,
-- order groups): the gross of the order services that are not cancelled,
-- computed per line like quotes and invoices (net = round(quantity x unit
-- price), VAT = round(net x rate), pass-through costs without VAT). NULL when
-- the order has no service lines at all, so callers can fall back to the
-- stored estimate of an order that has none yet.
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
               ROUND(service.quantity * service.unit_price_snapshot, 2) AS net,
               CASE
                   WHEN service.is_cost_passthrough THEN 0
                   ELSE ROUND(
                       ROUND(service.quantity * service.unit_price_snapshot, 2)
                           * service.vat_rate_snapshot / 100,
                       2
                   )
               END AS vat
        FROM order_leistungen service
        WHERE service.order_id = target_order_id
    ) line
$$;

COMMENT ON FUNCTION order_service_total_gross(UUID) IS
    'Gross total of the order services that are not cancelled (NULL without any service line).';
