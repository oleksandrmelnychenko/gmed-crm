WITH normalized AS (
    SELECT
        id,
        CASE lower(btrim(COALESCE(primary_language, '')))
            WHEN 'deutsch' THEN 'de'
            WHEN 'german' THEN 'de'
            WHEN 'englisch' THEN 'en'
            WHEN 'english' THEN 'en'
            WHEN 'russisch' THEN 'ru'
            WHEN 'russian' THEN 'ru'
            WHEN 'ukrainisch' THEN 'uk'
            WHEN 'ukrainian' THEN 'uk'
            WHEN 'spanisch' THEN 'es'
            WHEN 'spanish' THEN 'es'
            ELSE CASE
                WHEN primary_language IS NULL
                  OR btrim(primary_language) = ''
                  OR primary_language LIKE '%@%'
                THEN CASE lower(split_part(replace(COALESCE(locale, ''), '_', '-'), '-', 1))
                    WHEN 'de' THEN 'de'
                    WHEN 'en' THEN 'en'
                    WHEN 'ru' THEN 'ru'
                    WHEN 'uk' THEN 'uk'
                    WHEN 'es' THEN 'es'
                    ELSE primary_language
                END
                ELSE primary_language
            END
        END AS language_code
    FROM leads
)
UPDATE leads AS lead
SET primary_language = normalized.language_code
FROM normalized
WHERE lead.id = normalized.id
  AND normalized.language_code IS DISTINCT FROM lead.primary_language;

WITH normalized AS (
    SELECT
        id,
        CASE lower(btrim(COALESCE(primary_language, '')))
            WHEN 'deutsch' THEN 'de'
            WHEN 'german' THEN 'de'
            WHEN 'englisch' THEN 'en'
            WHEN 'english' THEN 'en'
            WHEN 'russisch' THEN 'ru'
            WHEN 'russian' THEN 'ru'
            WHEN 'ukrainisch' THEN 'uk'
            WHEN 'ukrainian' THEN 'uk'
            WHEN 'spanisch' THEN 'es'
            WHEN 'spanish' THEN 'es'
            ELSE CASE
                WHEN primary_language IS NULL
                  OR btrim(primary_language) = ''
                  OR primary_language LIKE '%@%'
                THEN CASE lower(split_part(replace(COALESCE(locale, ''), '_', '-'), '-', 1))
                    WHEN 'de' THEN 'de'
                    WHEN 'en' THEN 'en'
                    WHEN 'ru' THEN 'ru'
                    WHEN 'uk' THEN 'uk'
                    WHEN 'es' THEN 'es'
                    ELSE primary_language
                END
                ELSE primary_language
            END
        END AS language_code
    FROM visitor_intakes
)
UPDATE visitor_intakes AS intake
SET primary_language = normalized.language_code
FROM normalized
WHERE intake.id = normalized.id
  AND normalized.language_code IS DISTINCT FROM intake.primary_language;
