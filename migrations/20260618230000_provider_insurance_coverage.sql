CREATE TABLE IF NOT EXISTS insurance_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT GENERATED ALWAYS AS (
        lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
    ) STORED,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (char_length(name) <= 255)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_insurance_providers_normalized_name
    ON insurance_providers(normalized_name);

DROP TRIGGER IF EXISTS set_updated_at_insurance_providers ON insurance_providers;
CREATE TRIGGER set_updated_at_insurance_providers
BEFORE UPDATE ON insurance_providers
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO insurance_providers (name)
SELECT DISTINCT btrim(insurance_provider)
FROM patients
WHERE insurance_provider IS NOT NULL
  AND btrim(insurance_provider) <> ''
ON CONFLICT (normalized_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS provider_insurances (
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    insurance_provider_id UUID NOT NULL REFERENCES insurance_providers(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, insurance_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_insurances_insurance_provider_id
    ON provider_insurances(insurance_provider_id);

CREATE TABLE IF NOT EXISTS provider_doctor_insurances (
    doctor_id UUID NOT NULL REFERENCES provider_doctors(id) ON DELETE CASCADE,
    insurance_provider_id UUID NOT NULL REFERENCES insurance_providers(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (doctor_id, insurance_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_doctor_insurances_insurance_provider_id
    ON provider_doctor_insurances(insurance_provider_id);
