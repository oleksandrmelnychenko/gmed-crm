-- Preserve the commercial terms and catalog wording that were selected for an
-- order line.  Historical orders must not change when the live catalog entry
-- is edited or archived later.
ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS agency_service_key_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS agency_service_name_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS agency_service_description_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS agency_service_unit_label_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS unit_price_snapshot NUMERIC,
    ADD COLUMN IF NOT EXISTS currency_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS vat_rate_snapshot NUMERIC;

UPDATE order_leistungen line
SET agency_service_key_snapshot = catalog.service_key,
    agency_service_name_snapshot = catalog.service_name,
    agency_service_description_snapshot = catalog.description,
    agency_service_unit_label_snapshot = catalog.unit_label,
    unit_price_snapshot = line.unit_price,
    currency_snapshot = line.currency,
    vat_rate_snapshot = line.vat_rate
FROM agency_service_catalog catalog
WHERE catalog.id = line.agency_service_id
  AND (
        line.agency_service_key_snapshot IS NULL
        OR line.agency_service_name_snapshot IS NULL
        OR line.unit_price_snapshot IS NULL
        OR line.currency_snapshot IS NULL
        OR line.vat_rate_snapshot IS NULL
      );

UPDATE order_leistungen
SET unit_price_snapshot = COALESCE(unit_price_snapshot, unit_price),
    currency_snapshot = COALESCE(currency_snapshot, currency),
    vat_rate_snapshot = COALESCE(vat_rate_snapshot, vat_rate)
WHERE unit_price_snapshot IS NULL
   OR currency_snapshot IS NULL
   OR vat_rate_snapshot IS NULL;

ALTER TABLE order_leistungen
    ALTER COLUMN unit_price_snapshot SET NOT NULL,
    ALTER COLUMN currency_snapshot SET NOT NULL,
    ALTER COLUMN vat_rate_snapshot SET NOT NULL;

CREATE OR REPLACE FUNCTION snapshot_order_leistung_catalog()
RETURNS TRIGGER AS $$
DECLARE
    refresh_catalog_snapshot BOOLEAN := FALSE;
BEGIN
    -- Refresh catalog wording only for a newly linked service.  Ordinary
    -- updates to an existing line keep the original wording snapshot.
    IF NEW.agency_service_id IS NULL THEN
        NEW.agency_service_key_snapshot := NULL;
        NEW.agency_service_name_snapshot := NULL;
        NEW.agency_service_description_snapshot := NULL;
        NEW.agency_service_unit_label_snapshot := NULL;
    ELSIF TG_OP = 'INSERT' THEN
        refresh_catalog_snapshot := TRUE;
    ELSE
        refresh_catalog_snapshot :=
            NEW.agency_service_id IS DISTINCT FROM OLD.agency_service_id
            OR NEW.agency_service_name_snapshot IS NULL;
    END IF;

    IF refresh_catalog_snapshot THEN
        SELECT service_key, service_name, description, unit_label
        INTO NEW.agency_service_key_snapshot,
             NEW.agency_service_name_snapshot,
             NEW.agency_service_description_snapshot,
             NEW.agency_service_unit_label_snapshot
        FROM agency_service_catalog
        WHERE id = NEW.agency_service_id;
    END IF;

    -- These values are the commercial terms of this concrete order line. They
    -- may change only when the order line itself is intentionally changed.
    NEW.unit_price_snapshot := NEW.unit_price;
    NEW.currency_snapshot := NEW.currency;
    NEW.vat_rate_snapshot := NEW.vat_rate;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_order_leistung_catalog_snapshot ON order_leistungen;
CREATE TRIGGER set_order_leistung_catalog_snapshot
    BEFORE INSERT OR UPDATE OF agency_service_id, unit_price, currency, vat_rate
    ON order_leistungen
    FOR EACH ROW
    EXECUTE FUNCTION snapshot_order_leistung_catalog();
