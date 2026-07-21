-- Keep the company and responsible person in separate settings. Only normalize
-- known legacy values; administrator-defined company names remain untouched.
UPDATE system_settings
SET value = to_jsonb('GMED - Agentur für Patientenbetreuung'::text),
    description = 'Name des Unternehmens in generierten Dokumenten',
    updated_at = now()
WHERE key = 'agency_name'
  AND lower(btrim(value #>> '{}')) IN (
      'gmed',
      'gmed - agentur für patientenbetreuung heorhii hudiiev'
  );
