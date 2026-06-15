-- Doctor profile: add a website link and a free-text narrow specialization
-- (Schwerpunkt) alongside the main specialization (fachbereich).

ALTER TABLE provider_doctors
    ADD COLUMN IF NOT EXISTS website TEXT,
    ADD COLUMN IF NOT EXISTS schwerpunkt TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'provider_doctors_website_length_check'
    ) THEN
        ALTER TABLE provider_doctors
            ADD CONSTRAINT provider_doctors_website_length_check
            CHECK (website IS NULL OR char_length(website) <= 500);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'provider_doctors_schwerpunkt_length_check'
    ) THEN
        ALTER TABLE provider_doctors
            ADD CONSTRAINT provider_doctors_schwerpunkt_length_check
            CHECK (schwerpunkt IS NULL OR char_length(schwerpunkt) <= 255);
    END IF;
END $$;
