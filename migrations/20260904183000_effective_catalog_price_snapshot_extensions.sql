-- Extend the immutable price snapshots without changing the already-applied
-- 20260904180000 migration checksum.

ALTER TABLE order_service_groups
    ADD COLUMN IF NOT EXISTS agency_service_price_version_id UUID
        REFERENCES agency_service_price_versions(id) ON DELETE SET NULL;

WITH resolved AS (
    SELECT service_group.id,
           (
               SELECT version.id
               FROM agency_service_price_versions version
               WHERE version.agency_service_id = service_group.agency_service_id
                 AND version.valid_from <= COALESCE(
                        service_group.service_date,
                        ord.date_from,
                        service_group.created_at::DATE
                     )
                 AND (
                        version.valid_to IS NULL
                        OR version.valid_to >= COALESCE(
                            service_group.service_date,
                            ord.date_from,
                            service_group.created_at::DATE
                        )
                     )
                 AND version.unit_price = service_group.unit_price
                 AND UPPER(version.currency) = UPPER(service_group.currency)
                 AND version.vat_rate = service_group.vat_rate
               ORDER BY version.valid_from DESC, version.created_at DESC
               LIMIT 1
           ) AS price_version_id
    FROM order_service_groups service_group
    JOIN orders ord ON ord.id = service_group.order_id
    WHERE service_group.agency_service_id IS NOT NULL
      AND service_group.agency_service_price_version_id IS NULL
)
UPDATE order_service_groups service_group
SET agency_service_price_version_id = resolved.price_version_id
FROM resolved
WHERE service_group.id = resolved.id
  AND resolved.price_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_service_groups_agency_price_version
    ON order_service_groups(agency_service_price_version_id)
    WHERE agency_service_price_version_id IS NOT NULL;

ALTER TABLE patient_service_packages
    ALTER COLUMN base_price_net_snapshot SET DEFAULT 0,
    ALTER COLUMN base_price_vat_snapshot SET DEFAULT 0,
    ALTER COLUMN base_price_gross_snapshot SET DEFAULT 0,
    ALTER COLUMN currency_snapshot SET DEFAULT 'EUR';

ALTER TABLE service_package_consumptions
    ADD COLUMN IF NOT EXISTS tax_profile_id_snapshot UUID
        REFERENCES tax_profiles(id) ON DELETE SET NULL;

WITH resolved AS (
    SELECT consumption.id,
           CASE
               WHEN item_tax.id IS NOT NULL THEN item_tax.id
               WHEN catalog.id IS NOT NULL THEN NULL
               ELSE package_tax.id
           END AS tax_profile_id
    FROM service_package_consumptions consumption
    JOIN patient_service_packages patient_package
      ON patient_package.id = consumption.patient_service_package_id
    JOIN service_packages package ON package.id = patient_package.package_id
    LEFT JOIN service_package_items item ON item.id = consumption.package_item_id
    LEFT JOIN agency_service_catalog catalog ON catalog.id = item.agency_service_id
    LEFT JOIN tax_profiles item_tax ON item_tax.id = item.tax_profile_id
    LEFT JOIN tax_profiles package_tax ON package_tax.id = package.tax_profile_id
)
UPDATE service_package_consumptions consumption
SET tax_profile_id_snapshot = resolved.tax_profile_id
FROM resolved
WHERE consumption.id = resolved.id;

ALTER TABLE service_package_consumptions
    ALTER COLUMN unit_price_net_snapshot SET DEFAULT 0,
    ALTER COLUMN currency_snapshot SET DEFAULT 'EUR',
    ALTER COLUMN vat_rate_snapshot SET DEFAULT 0;
