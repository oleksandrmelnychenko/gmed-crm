ALTER TABLE interpreter_languages
    ADD COLUMN IF NOT EXISTS cefr_level TEXT
        CHECK (
            cefr_level IS NULL
            OR cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')
        ),
    ADD COLUMN IF NOT EXISTS specialization TEXT;
