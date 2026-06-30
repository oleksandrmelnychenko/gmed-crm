-- Backfill fields that older public-intake code stored only inside raw_payload.
-- The website originally submitted dateOfBirth as DD.MM.YYYY while the CRM
-- parser accepted only YYYY-MM-DD, so date_of_birth stayed NULL.

WITH parsed_dates AS (
    SELECT
        id,
        btrim(raw_payload #>> '{payload,dateOfBirth}') AS raw_date_of_birth
    FROM leads
    WHERE date_of_birth IS NULL
      AND raw_payload #>> '{payload,dateOfBirth}' IS NOT NULL
)
UPDATE leads AS lead
SET date_of_birth = CASE
    WHEN parsed.raw_date_of_birth ~ '^\d{4}-\d{2}-\d{2}$'
        THEN to_date(parsed.raw_date_of_birth, 'YYYY-MM-DD')
    WHEN parsed.raw_date_of_birth ~ '^\d{2}\.\d{2}\.\d{4}$'
        THEN to_date(parsed.raw_date_of_birth, 'DD.MM.YYYY')
    WHEN parsed.raw_date_of_birth ~ '^\d{2}/\d{2}/\d{4}$'
        THEN to_date(parsed.raw_date_of_birth, 'DD/MM/YYYY')
    ELSE lead.date_of_birth
END
FROM parsed_dates AS parsed
WHERE lead.id = parsed.id
  AND (
      parsed.raw_date_of_birth ~ '^\d{4}-\d{2}-\d{2}$'
      OR parsed.raw_date_of_birth ~ '^\d{2}\.\d{2}\.\d{4}$'
      OR parsed.raw_date_of_birth ~ '^\d{2}/\d{2}/\d{4}$'
  );

UPDATE leads
SET state = NULL
WHERE state IS NOT NULL
  AND btrim(state) ~ '^0+$';

UPDATE leads
SET zip_code = NULL
WHERE zip_code IS NOT NULL
  AND btrim(zip_code) ~ '^0+$';
