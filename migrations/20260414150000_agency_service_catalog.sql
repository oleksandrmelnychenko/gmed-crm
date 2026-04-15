CREATE TABLE agency_service_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_key TEXT NOT NULL UNIQUE,
    service_name TEXT NOT NULL,
    description TEXT,
    unit_label TEXT NOT NULL DEFAULT 'unit',
    unit_price NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    vat_rate NUMERIC NOT NULL DEFAULT 19,
    is_active BOOLEAN NOT NULL DEFAULT true,
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agency_service_catalog_active
    ON agency_service_catalog(is_active, valid_from DESC, service_name);

CREATE INDEX idx_agency_service_catalog_validity
    ON agency_service_catalog(valid_from DESC, valid_to);

CREATE TRIGGER set_updated_at_agency_service_catalog
    BEFORE UPDATE ON agency_service_catalog
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
