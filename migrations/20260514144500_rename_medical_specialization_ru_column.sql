-- Normalize the specialization Russian label column name.
-- Existing databases created before this migration used name_uk for the same RU label.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'medical_specializations'
          AND column_name = 'name_uk'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'medical_specializations'
          AND column_name = 'name_ru'
    ) THEN
        ALTER TABLE medical_specializations RENAME COLUMN name_uk TO name_ru;
    ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'medical_specializations'
          AND column_name = 'name_uk'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'medical_specializations'
          AND column_name = 'name_ru'
    ) THEN
        UPDATE medical_specializations
        SET name_ru = COALESCE(NULLIF(btrim(name_ru), ''), name_uk),
            updated_at = now()
        WHERE name_uk IS NOT NULL
          AND (name_ru IS NULL OR btrim(name_ru) = '');

        ALTER TABLE medical_specializations DROP COLUMN name_uk;
    ELSIF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'medical_specializations'
          AND column_name = 'name_ru'
    ) THEN
        ALTER TABLE medical_specializations ADD COLUMN name_ru TEXT;
    END IF;
END $$;
