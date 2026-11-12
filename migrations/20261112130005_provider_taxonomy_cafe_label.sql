-- The Russian name of the café provider type carried a stray combining accent
-- ("Кафе́", migration 20260617100000); concierge QA 2026-11-12 D-11 / B S3-5.4.
UPDATE provider_taxonomy_nodes
SET name_ru = 'Кафе'
WHERE code = 'nonmedical_cafe'
  AND name_ru <> 'Кафе';
