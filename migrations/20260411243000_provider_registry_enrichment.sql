ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS legal_name TEXT,
    ADD COLUMN IF NOT EXISTS tax_id TEXT;

ALTER TABLE provider_doctors
    ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS license_number TEXT,
    ADD COLUMN IF NOT EXISTS licensing_country TEXT,
    ADD COLUMN IF NOT EXISTS licensing_valid_until DATE;

CREATE INDEX IF NOT EXISTS idx_providers_tax_id
    ON providers(tax_id)
    WHERE tax_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_doctors_license_number
    ON provider_doctors(license_number)
    WHERE license_number IS NOT NULL;
