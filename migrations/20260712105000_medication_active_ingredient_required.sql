UPDATE medikamente
SET wirkstoff = COALESCE(
    NULLIF(btrim(wirkstoff), ''),
    NULLIF(btrim(handelsname), ''),
    'Unbekannter Wirkstoff'
)
WHERE wirkstoff IS NULL OR btrim(wirkstoff) = '';

UPDATE patient_medications
SET wirkstoff = COALESCE(
    NULLIF(btrim(wirkstoff), ''),
    NULLIF(btrim(handelsname), ''),
    'Unbekannter Wirkstoff'
)
WHERE wirkstoff IS NULL OR btrim(wirkstoff) = '';

ALTER TABLE medikamente
    ALTER COLUMN wirkstoff SET NOT NULL,
    ALTER COLUMN handelsname SET DEFAULT '';

ALTER TABLE patient_medications
    ALTER COLUMN wirkstoff SET NOT NULL,
    ALTER COLUMN handelsname SET DEFAULT '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'medikamente_wirkstoff_not_blank'
    ) THEN
        ALTER TABLE medikamente
            ADD CONSTRAINT medikamente_wirkstoff_not_blank CHECK (btrim(wirkstoff) <> '');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'patient_medications_wirkstoff_not_blank'
    ) THEN
        ALTER TABLE patient_medications
            ADD CONSTRAINT patient_medications_wirkstoff_not_blank CHECK (btrim(wirkstoff) <> '');
    END IF;
END $$;

COMMENT ON COLUMN medikamente.wirkstoff IS 'Required active ingredient (Wirkstoff).';
COMMENT ON COLUMN medikamente.handelsname IS 'Optional trade/brand name; empty string means not provided.';
COMMENT ON COLUMN patient_medications.wirkstoff IS 'Required active ingredient (Wirkstoff).';
COMMENT ON COLUMN patient_medications.handelsname IS 'Optional trade/brand name; empty string means not provided.';
