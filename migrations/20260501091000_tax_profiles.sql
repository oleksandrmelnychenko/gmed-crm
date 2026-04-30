CREATE TABLE IF NOT EXISTS tax_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    vat_rate NUMERIC NOT NULL DEFAULT 0,
    vat_category TEXT NOT NULL DEFAULT 'standard'
        CHECK (vat_category IN ('standard', 'zero_rated', 'exempt', 'reverse_charge', 'custom')),
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_profiles_single_default
    ON tax_profiles(is_default)
    WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_tax_profiles_active
    ON tax_profiles(is_active, valid_from DESC, profile_key);

CREATE TRIGGER set_updated_at_tax_profiles
    BEFORE UPDATE ON tax_profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO tax_profiles (profile_key, name, description, vat_rate, vat_category, is_default)
VALUES
    ('standard_vat', 'Standard VAT', 'Default VAT profile for taxable services such as interpreter support.', 19, 'standard', true),
    ('termin_fee_0', 'Termin fee 0% VAT', 'Default zero VAT profile for appointment/termin organization fees.', 0, 'zero_rated', false),
    ('vat_exempt_0', 'VAT exempt 0%', 'Generic VAT exempt profile for manually reviewed services.', 0, 'exempt', false)
ON CONFLICT (profile_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    vat_rate = EXCLUDED.vat_rate,
    vat_category = EXCLUDED.vat_category,
    is_active = true,
    updated_at = now();

ALTER TABLE agency_service_catalog
    ADD COLUMN IF NOT EXISTS tax_profile_id UUID REFERENCES tax_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS vat_source TEXT NOT NULL DEFAULT 'catalog'
        CHECK (vat_source IN ('catalog', 'tax_profile', 'manual', 'legacy'));

ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS tax_profile_id UUID REFERENCES tax_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS vat_source TEXT NOT NULL DEFAULT 'legacy'
        CHECK (vat_source IN ('catalog', 'tax_profile', 'manual', 'legacy'));

UPDATE agency_service_catalog catalog
SET tax_profile_id = profile.id,
    vat_rate = profile.vat_rate,
    vat_source = 'tax_profile',
    updated_at = now()
FROM tax_profiles profile
WHERE catalog.service_key = 'treatment_organization'
  AND profile.profile_key = 'termin_fee_0';

UPDATE agency_service_catalog catalog
SET tax_profile_id = profile.id,
    vat_rate = profile.vat_rate,
    vat_source = 'tax_profile',
    updated_at = now()
FROM tax_profiles profile
WHERE catalog.service_key = 'interpreter_hours'
  AND profile.profile_key = 'standard_vat';

INSERT INTO agency_service_catalog (
    service_key, service_name, description, unit_label, unit_price, currency,
    vat_rate, tax_profile_id, vat_source, is_active, valid_from, created_by
)
SELECT
    'treatment_organization',
    'Termin organization fee',
    'Appointment/termin organization fee with 0% VAT.',
    'appointment',
    0,
    'EUR',
    profile.vat_rate,
    profile.id,
    'tax_profile',
    true,
    CURRENT_DATE,
    actor.id
FROM tax_profiles profile
CROSS JOIN LATERAL (
    SELECT id
    FROM users
    WHERE role IN ('billing', 'ceo')
      AND is_active = true
    ORDER BY created_at
    LIMIT 1
) actor
WHERE profile.profile_key = 'termin_fee_0'
  AND NOT EXISTS (
      SELECT 1 FROM agency_service_catalog WHERE service_key = 'treatment_organization'
  );

CREATE INDEX IF NOT EXISTS idx_agency_service_catalog_tax_profile
    ON agency_service_catalog(tax_profile_id)
    WHERE tax_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_leistungen_tax_profile
    ON order_leistungen(tax_profile_id)
    WHERE tax_profile_id IS NOT NULL;
