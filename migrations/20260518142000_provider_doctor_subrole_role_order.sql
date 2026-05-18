-- Doctor positions: keep scientific title separate from position/subposition.

ALTER TABLE provider_doctors
    ADD COLUMN IF NOT EXISTS subrole TEXT;

UPDATE provider_doctors
SET role_label = COALESCE(NULLIF(btrim(role_label), ''), 'Head of department'),
    role_code = 'other'
WHERE role_code = 'head_of_department';

ALTER TABLE provider_doctors
    DROP CONSTRAINT IF EXISTS provider_doctors_role_code_check;

ALTER TABLE provider_doctors
    ADD CONSTRAINT provider_doctors_role_code_check
    CHECK (
        role_code IS NULL
        OR role_code IN (
            'clinical_director',
            'chefarzt',
            'oberarzt',
            'facharzt',
            'assistenzarzt',
            'other'
        )
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'provider_doctors_subrole_length_check'
    ) THEN
        ALTER TABLE provider_doctors
            ADD CONSTRAINT provider_doctors_subrole_length_check
            CHECK (subrole IS NULL OR char_length(subrole) <= 255);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_doctors_role_code
    ON provider_doctors(role_code);

CREATE INDEX IF NOT EXISTS idx_provider_doctors_gender
    ON provider_doctors(gender);
