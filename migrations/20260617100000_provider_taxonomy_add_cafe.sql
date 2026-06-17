-- Add "Café / Кафе́" as a non-medical gastronomy provider type, configured exactly
-- like Catering (same group, level, provider kind and filter keys).
WITH seed(code, parent_code, level, provider_kind, name_de, name_ru, sort_order, filter_keys) AS (
    VALUES
        ('nonmedical_cafe', 'nonmedical_gastronomy_nutrition', 'type', 'non_medical', 'Café', 'Кафе́', 235,
         ARRAY['city','country','cuisine','diet','has_contract','internal_rating','linked_patient'])
)
INSERT INTO provider_taxonomy_nodes (
    code, level, provider_kind, name_de, name_ru, sort_order, filter_keys
)
SELECT code, level, provider_kind, name_de, name_ru, sort_order, filter_keys
FROM seed
ON CONFLICT (code) DO UPDATE
SET level = EXCLUDED.level,
    provider_kind = EXCLUDED.provider_kind,
    name_de = EXCLUDED.name_de,
    name_ru = EXCLUDED.name_ru,
    sort_order = EXCLUDED.sort_order,
    filter_keys = EXCLUDED.filter_keys,
    is_active = TRUE;

UPDATE provider_taxonomy_nodes child
SET parent_id = parent.id
FROM provider_taxonomy_nodes parent
WHERE parent.code = 'nonmedical_gastronomy_nutrition'
  AND child.code = 'nonmedical_cafe'
  AND child.parent_id IS DISTINCT FROM parent.id;
