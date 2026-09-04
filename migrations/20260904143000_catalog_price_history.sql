CREATE TABLE IF NOT EXISTS agency_service_price_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agency_service_id UUID NOT NULL REFERENCES agency_service_catalog(id) ON DELETE CASCADE,
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    currency TEXT NOT NULL DEFAULT 'EUR',
    vat_rate NUMERIC NOT NULL DEFAULT 19 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agency_service_price_versions_period_check
        CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT agency_service_price_versions_start_unique
        UNIQUE (agency_service_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_agency_service_price_versions_lookup
    ON agency_service_price_versions(agency_service_id, valid_from DESC, valid_to);

INSERT INTO agency_service_price_versions (
    agency_service_id, unit_price, currency, vat_rate,
    valid_from, valid_to, created_by, created_at
)
SELECT id, unit_price, currency, vat_rate,
       valid_from, valid_to, COALESCE(updated_by, created_by), created_at
FROM agency_service_catalog
ON CONFLICT (agency_service_id, valid_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS service_package_price_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
    base_price_net NUMERIC NOT NULL CHECK (base_price_net >= 0),
    base_price_vat NUMERIC NOT NULL DEFAULT 0 CHECK (base_price_vat >= 0),
    base_price_gross NUMERIC NOT NULL DEFAULT 0 CHECK (base_price_gross >= 0),
    currency TEXT NOT NULL DEFAULT 'EUR',
    tax_profile_id UUID REFERENCES tax_profiles(id) ON DELETE SET NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT service_package_price_versions_period_check
        CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT service_package_price_versions_start_unique
        UNIQUE (package_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_service_package_price_versions_lookup
    ON service_package_price_versions(package_id, valid_from DESC, valid_to);

INSERT INTO service_package_price_versions (
    package_id, base_price_net, base_price_vat, base_price_gross,
    currency, tax_profile_id, valid_from, valid_to, created_by, created_at
)
SELECT id, base_price_net, base_price_vat, base_price_gross,
       currency, tax_profile_id, valid_from, valid_to,
       COALESCE(updated_by, created_by), created_at
FROM service_packages
ON CONFLICT (package_id, valid_from) DO NOTHING;
