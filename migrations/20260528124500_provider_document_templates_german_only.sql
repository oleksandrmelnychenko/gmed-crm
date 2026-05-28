UPDATE provider_templates
SET supported_languages = ARRAY['de']::TEXT[],
    body_en = NULL,
    body_uk = NULL,
    body_ru = NULL,
    updated_at = now()
WHERE supported_languages <> ARRAY['de']::TEXT[]
   OR body_en IS NOT NULL
   OR body_uk IS NOT NULL
   OR body_ru IS NOT NULL;
