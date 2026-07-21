-- Canonical company identity for generated documents. Preserve administrator
-- overrides while replacing the legacy care-of placeholder used by old labels.
INSERT INTO system_settings (key, value, description)
VALUES
    (
        'agency_name',
        to_jsonb('GMED'::text),
        'Name des Unternehmens in generierten Dokumenten'
    ),
    (
        'agency_care_of',
        to_jsonb('Heorhii Hudiiev'::text),
        'Verantwortliche Person und Unterzeichner in generierten Dokumenten'
    )
ON CONFLICT (key) DO UPDATE
SET value = CASE
        WHEN NULLIF(btrim(system_settings.value #>> '{}'), '') IS NULL
          OR (
              EXCLUDED.key = 'agency_care_of'
              AND lower(btrim(system_settings.value #>> '{}')) = 'c/o gmed'
          )
            THEN EXCLUDED.value
        ELSE system_settings.value
    END,
    description = EXCLUDED.description,
    updated_at = CASE
        WHEN NULLIF(btrim(system_settings.value #>> '{}'), '') IS NULL
          OR (
              EXCLUDED.key = 'agency_care_of'
              AND lower(btrim(system_settings.value #>> '{}')) = 'c/o gmed'
          )
            THEN now()
        ELSE system_settings.updated_at
    END;
