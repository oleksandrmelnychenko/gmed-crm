ALTER TABLE agency_service_price_versions
    ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE agency_service_price_versions
SET name = CONCAT(valid_from::TEXT, ' · ', unit_price::TEXT, ' ', currency)
WHERE name IS NULL OR BTRIM(name) = '';

ALTER TABLE agency_service_price_versions
    ALTER COLUMN name SET NOT NULL;

ALTER TABLE agency_service_price_versions
    DROP CONSTRAINT IF EXISTS agency_service_price_versions_name_check;

ALTER TABLE agency_service_price_versions
    ADD CONSTRAINT agency_service_price_versions_name_check
    CHECK (BTRIM(name) <> '' AND CHAR_LENGTH(name) <= 160);

ALTER TABLE service_package_price_versions
    ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE service_package_price_versions
SET name = CONCAT(valid_from::TEXT, ' · ', base_price_net::TEXT, ' ', currency)
WHERE name IS NULL OR BTRIM(name) = '';

ALTER TABLE service_package_price_versions
    ALTER COLUMN name SET NOT NULL;

ALTER TABLE service_package_price_versions
    DROP CONSTRAINT IF EXISTS service_package_price_versions_name_check;

ALTER TABLE service_package_price_versions
    ADD CONSTRAINT service_package_price_versions_name_check
    CHECK (BTRIM(name) <> '' AND CHAR_LENGTH(name) <= 160);
