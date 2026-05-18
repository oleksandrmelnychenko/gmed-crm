-- Provider-level reception/availability hours.

ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS opening_hours TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'providers_opening_hours_length_check'
          AND conrelid = 'providers'::regclass
    ) THEN
        ALTER TABLE providers
            ADD CONSTRAINT providers_opening_hours_length_check
            CHECK (opening_hours IS NULL OR length(opening_hours) <= 4000);
    END IF;
END $$;
