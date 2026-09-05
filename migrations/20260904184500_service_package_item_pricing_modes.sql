-- A package item can either follow the catalog price effective on the
-- consumption date, pin one catalog price version, or store a manual overage
-- price. NULL in both price columns keeps the automatic-date behavior.

ALTER TABLE service_package_items
    ADD COLUMN IF NOT EXISTS agency_service_price_version_id UUID
        REFERENCES agency_service_price_versions(id) ON DELETE SET NULL;

ALTER TABLE service_package_items
    ADD CONSTRAINT service_package_items_price_mode_check
        CHECK (NOT (
            agency_service_price_version_id IS NOT NULL
            AND overage_unit_price_net IS NOT NULL
        )),
    ADD CONSTRAINT service_package_items_explicit_price_service_check
        CHECK (
            agency_service_price_version_id IS NULL
            OR agency_service_id IS NOT NULL
        );

CREATE INDEX IF NOT EXISTS idx_service_package_items_agency_price_version
    ON service_package_items(agency_service_price_version_id)
    WHERE agency_service_price_version_id IS NOT NULL;
