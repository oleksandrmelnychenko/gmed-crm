WITH premium_provider AS (
    SELECT id
    FROM providers
    WHERE provider_type = 'non_medical'
      AND (
          id = 'c0000000-0000-0000-0000-000000000005'::uuid
          OR name ILIKE 'Premium Medical Travel GmbH'
          OR legal_name ILIKE 'Premium Medical Travel GmbH'
      )
),
target_assignments(provider_id, code, is_primary) AS (
    SELECT id, 'nonmedical_chauffeur', TRUE FROM premium_provider
    UNION ALL
    SELECT id, 'nonmedical_airports', FALSE FROM premium_provider
    UNION ALL
    SELECT id, 'nonmedical_hotels', FALSE FROM premium_provider
)
UPDATE provider_taxonomy_assignments existing
SET is_primary = FALSE
FROM target_assignments target
WHERE existing.provider_id = target.provider_id
  AND existing.is_primary = TRUE;

WITH premium_provider AS (
    SELECT id
    FROM providers
    WHERE provider_type = 'non_medical'
      AND (
          id = 'c0000000-0000-0000-0000-000000000005'::uuid
          OR name ILIKE 'Premium Medical Travel GmbH'
          OR legal_name ILIKE 'Premium Medical Travel GmbH'
      )
),
default_node AS (
    SELECT id
    FROM provider_taxonomy_nodes
    WHERE code = 'nonmedical_other'
)
DELETE FROM provider_taxonomy_assignments existing
USING premium_provider provider, default_node node
WHERE existing.provider_id = provider.id
  AND existing.taxonomy_node_id = node.id;

WITH premium_provider AS (
    SELECT id
    FROM providers
    WHERE provider_type = 'non_medical'
      AND (
          id = 'c0000000-0000-0000-0000-000000000005'::uuid
          OR name ILIKE 'Premium Medical Travel GmbH'
          OR legal_name ILIKE 'Premium Medical Travel GmbH'
      )
),
target_assignments(provider_id, code, is_primary) AS (
    SELECT id, 'nonmedical_chauffeur', TRUE FROM premium_provider
    UNION ALL
    SELECT id, 'nonmedical_airports', FALSE FROM premium_provider
    UNION ALL
    SELECT id, 'nonmedical_hotels', FALSE FROM premium_provider
)
INSERT INTO provider_taxonomy_assignments (provider_id, taxonomy_node_id, is_primary)
SELECT target.provider_id, node.id, target.is_primary
FROM target_assignments target
JOIN provider_taxonomy_nodes node
  ON node.code = target.code
 AND node.level = 'type'
 AND node.provider_kind = 'non_medical'
 AND node.is_active = TRUE
ON CONFLICT (provider_id, taxonomy_node_id) DO UPDATE
SET is_primary = EXCLUDED.is_primary;

WITH mapped_services(service_name, code) AS (
    VALUES
        ('Airport meet and greet', 'nonmedical_airports'),
        ('Hotel coordination', 'nonmedical_hotels')
),
premium_provider AS (
    SELECT id
    FROM providers
    WHERE provider_type = 'non_medical'
      AND (
          id = 'c0000000-0000-0000-0000-000000000005'::uuid
          OR name ILIKE 'Premium Medical Travel GmbH'
          OR legal_name ILIKE 'Premium Medical Travel GmbH'
      )
),
service_targets AS (
    SELECT service.id, mapped.code
    FROM service_catalog service
    JOIN premium_provider provider
      ON provider.id = service.provider_id
    JOIN mapped_services mapped
      ON btrim(lower(service.service_name)) = btrim(lower(mapped.service_name))
    LEFT JOIN provider_taxonomy_nodes current_node
      ON current_node.id = service.taxonomy_node_id
    WHERE COALESCE(current_node.code, 'nonmedical_other') = 'nonmedical_other'
)
UPDATE service_catalog service
SET taxonomy_node_id = node.id
FROM service_targets target
JOIN provider_taxonomy_nodes node
  ON node.code = target.code
 AND node.level = 'type'
 AND node.provider_kind = 'non_medical'
 AND node.is_active = TRUE
WHERE service.id = target.id;

WITH service_targets AS (
    SELECT
        service.id,
        CASE
            WHEN service.service_kind = 'hotel' THEN 'nonmedical_hotels'
            WHEN service.service_kind IN ('transfer', 'chauffeur') THEN 'nonmedical_chauffeur'
            WHEN service.service_kind = 'vip_terminal' THEN 'nonmedical_airports'
            WHEN service.service_kind = 'flight' THEN 'nonmedical_business_aviation'
            ELSE NULL
        END AS code
    FROM concierge_services service
    LEFT JOIN provider_taxonomy_nodes current_node
      ON current_node.id = service.taxonomy_node_id
    WHERE COALESCE(current_node.code, 'nonmedical_other') = 'nonmedical_other'
)
UPDATE concierge_services service
SET taxonomy_node_id = node.id,
    updated_at = now()
FROM service_targets target
JOIN provider_taxonomy_nodes node
  ON node.code = target.code
 AND node.level = 'type'
 AND node.provider_kind = 'non_medical'
 AND node.is_active = TRUE
WHERE service.id = target.id
  AND target.code IS NOT NULL;
