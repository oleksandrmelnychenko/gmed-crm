-- Resolve dated catalog prices once and preserve the selected commercial terms
-- on the business record that used them.

ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS agency_service_price_version_id UUID
        REFERENCES agency_service_price_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_leistungen_agency_price_version
    ON order_leistungen(agency_service_price_version_id)
    WHERE agency_service_price_version_id IS NOT NULL;

WITH resolved AS (
    SELECT line.id,
           (
               SELECT version.id
               FROM agency_service_price_versions version
               WHERE version.agency_service_id = line.agency_service_id
                 AND version.valid_from <= COALESCE(ord.date_from, line.created_at::DATE)
                 AND (
                        version.valid_to IS NULL
                        OR version.valid_to >= COALESCE(ord.date_from, line.created_at::DATE)
                     )
                 AND version.unit_price = line.unit_price_snapshot
                 AND UPPER(version.currency) = UPPER(line.currency_snapshot)
                 AND version.vat_rate = line.vat_rate_snapshot
               ORDER BY version.valid_from DESC, version.created_at DESC
               LIMIT 1
           ) AS price_version_id
    FROM order_leistungen line
    JOIN orders ord ON ord.id = line.order_id
    WHERE line.agency_service_id IS NOT NULL
      AND line.agency_service_price_version_id IS NULL
)
UPDATE order_leistungen line
SET agency_service_price_version_id = resolved.price_version_id
FROM resolved
WHERE line.id = resolved.id
  AND resolved.price_version_id IS NOT NULL;

ALTER TABLE patient_service_packages
    ADD COLUMN IF NOT EXISTS package_price_version_id UUID
        REFERENCES service_package_price_versions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS base_price_net_snapshot NUMERIC,
    ADD COLUMN IF NOT EXISTS base_price_vat_snapshot NUMERIC,
    ADD COLUMN IF NOT EXISTS base_price_gross_snapshot NUMERIC,
    ADD COLUMN IF NOT EXISTS currency_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS tax_profile_id_snapshot UUID
        REFERENCES tax_profiles(id) ON DELETE SET NULL;

WITH resolved AS (
    SELECT patient_package.id,
           price.id AS price_version_id,
           COALESCE(price.base_price_net, package.base_price_net) AS base_price_net,
           COALESCE(price.base_price_vat, package.base_price_vat) AS base_price_vat,
           COALESCE(price.base_price_gross, package.base_price_gross) AS base_price_gross,
           COALESCE(price.currency, package.currency) AS currency,
           CASE
               WHEN price.id IS NOT NULL THEN price.tax_profile_id
               ELSE package.tax_profile_id
           END AS tax_profile_id
    FROM patient_service_packages patient_package
    JOIN service_packages package ON package.id = patient_package.package_id
    LEFT JOIN LATERAL (
        SELECT version.id, version.base_price_net, version.base_price_vat,
               version.base_price_gross, version.currency, version.tax_profile_id
        FROM service_package_price_versions version
        WHERE version.package_id = patient_package.package_id
          AND version.valid_from <= COALESCE(
                patient_package.starts_on,
                patient_package.assigned_at::DATE
              )
          AND (
                version.valid_to IS NULL
                OR version.valid_to >= COALESCE(
                    patient_package.starts_on,
                    patient_package.assigned_at::DATE
                )
              )
        ORDER BY version.valid_from DESC, version.created_at DESC
        LIMIT 1
    ) price ON TRUE
)
UPDATE patient_service_packages patient_package
SET package_price_version_id = resolved.price_version_id,
    base_price_net_snapshot = resolved.base_price_net,
    base_price_vat_snapshot = resolved.base_price_vat,
    base_price_gross_snapshot = resolved.base_price_gross,
    currency_snapshot = resolved.currency,
    tax_profile_id_snapshot = resolved.tax_profile_id
FROM resolved
WHERE patient_package.id = resolved.id;

UPDATE patient_service_packages
SET base_price_net_snapshot = COALESCE(base_price_net_snapshot, 0),
    base_price_vat_snapshot = COALESCE(base_price_vat_snapshot, 0),
    base_price_gross_snapshot = COALESCE(base_price_gross_snapshot, 0),
    currency_snapshot = COALESCE(NULLIF(UPPER(BTRIM(currency_snapshot)), ''), 'EUR');

ALTER TABLE patient_service_packages
    ALTER COLUMN base_price_net_snapshot SET NOT NULL,
    ALTER COLUMN base_price_vat_snapshot SET NOT NULL,
    ALTER COLUMN base_price_gross_snapshot SET NOT NULL,
    ALTER COLUMN currency_snapshot SET NOT NULL;

ALTER TABLE patient_service_packages
    DROP CONSTRAINT IF EXISTS patient_service_packages_price_snapshot_check;

ALTER TABLE patient_service_packages
    ADD CONSTRAINT patient_service_packages_price_snapshot_check
    CHECK (
        base_price_net_snapshot >= 0
        AND base_price_vat_snapshot >= 0
        AND base_price_gross_snapshot >= 0
    );

CREATE INDEX IF NOT EXISTS idx_patient_service_packages_price_version
    ON patient_service_packages(package_price_version_id)
    WHERE package_price_version_id IS NOT NULL;

ALTER TABLE service_package_consumptions
    ADD COLUMN IF NOT EXISTS agency_service_price_version_id UUID
        REFERENCES agency_service_price_versions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS unit_price_net_snapshot NUMERIC,
    ADD COLUMN IF NOT EXISTS currency_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS vat_rate_snapshot NUMERIC;

WITH resolved AS (
    SELECT consumption.id,
           CASE
               WHEN item.overage_unit_price_net IS NULL THEN price.id
               ELSE NULL
           END AS price_version_id,
           COALESCE(item.overage_unit_price_net, price.unit_price, catalog.unit_price, 0)
               AS unit_price_net,
           COALESCE(price.currency, catalog.currency, package.currency, 'EUR') AS currency,
           COALESCE(
               item_tax.vat_rate,
               price.vat_rate,
               catalog.vat_rate,
               package_tax.vat_rate,
               0
           ) AS vat_rate
    FROM service_package_consumptions consumption
    JOIN patient_service_packages patient_package
      ON patient_package.id = consumption.patient_service_package_id
    JOIN service_packages package ON package.id = patient_package.package_id
    LEFT JOIN service_package_items item ON item.id = consumption.package_item_id
    LEFT JOIN agency_service_catalog catalog ON catalog.id = item.agency_service_id
    LEFT JOIN tax_profiles item_tax ON item_tax.id = item.tax_profile_id
    LEFT JOIN tax_profiles package_tax ON package_tax.id = package.tax_profile_id
    LEFT JOIN LATERAL (
        SELECT version.id, version.unit_price, version.currency, version.vat_rate
        FROM agency_service_price_versions version
        WHERE version.agency_service_id = item.agency_service_id
          AND version.valid_from <= consumption.consumed_at::DATE
          AND (
                version.valid_to IS NULL
                OR version.valid_to >= consumption.consumed_at::DATE
              )
        ORDER BY version.valid_from DESC, version.created_at DESC
        LIMIT 1
    ) price ON TRUE
)
UPDATE service_package_consumptions consumption
SET agency_service_price_version_id = resolved.price_version_id,
    unit_price_net_snapshot = resolved.unit_price_net,
    currency_snapshot = resolved.currency,
    vat_rate_snapshot = resolved.vat_rate
FROM resolved
WHERE consumption.id = resolved.id;

UPDATE service_package_consumptions
SET unit_price_net_snapshot = COALESCE(unit_price_net_snapshot, 0),
    currency_snapshot = COALESCE(NULLIF(UPPER(BTRIM(currency_snapshot)), ''), 'EUR'),
    vat_rate_snapshot = COALESCE(vat_rate_snapshot, 0);

ALTER TABLE service_package_consumptions
    ALTER COLUMN unit_price_net_snapshot SET NOT NULL,
    ALTER COLUMN currency_snapshot SET NOT NULL,
    ALTER COLUMN vat_rate_snapshot SET NOT NULL;

ALTER TABLE service_package_consumptions
    DROP CONSTRAINT IF EXISTS service_package_consumptions_price_snapshot_check;

ALTER TABLE service_package_consumptions
    ADD CONSTRAINT service_package_consumptions_price_snapshot_check
    CHECK (
        unit_price_net_snapshot >= 0
        AND vat_rate_snapshot >= 0
        AND vat_rate_snapshot <= 100
    );

CREATE INDEX IF NOT EXISTS idx_service_package_consumptions_price_version
    ON service_package_consumptions(agency_service_price_version_id)
    WHERE agency_service_price_version_id IS NOT NULL;
