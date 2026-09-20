-- Self-service account profile (Stage 1 of the role cabinets plan).
-- Phone and the preferred UI language are edited by the user on /account;
-- `preferred_language` is applied by the frontend on sign-in.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS preferred_language TEXT
        CHECK (preferred_language IS NULL OR preferred_language IN ('ru', 'de'));
