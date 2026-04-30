CREATE TABLE IF NOT EXISTS service_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    currency TEXT NOT NULL DEFAULT 'EUR',
    base_price_net NUMERIC NOT NULL DEFAULT 0,
    base_price_vat NUMERIC NOT NULL DEFAULT 0,
    base_price_gross NUMERIC NOT NULL DEFAULT 0,
    tax_profile_id UUID REFERENCES tax_profiles(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_package_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
    agency_service_id UUID REFERENCES agency_service_catalog(id) ON DELETE SET NULL,
    service_key TEXT,
    description TEXT NOT NULL,
    included_quantity NUMERIC NOT NULL DEFAULT 0,
    unit_label TEXT NOT NULL DEFAULT 'unit',
    overage_unit_price_net NUMERIC,
    tax_profile_id UUID REFERENCES tax_profiles(id) ON DELETE SET NULL,
    requires_patient_approval BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_service_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
    starts_on DATE,
    ends_on DATE,
    payer_contact_name TEXT,
    payer_contact_email TEXT,
    payer_contact_phone TEXT,
    payer_contact_relationship TEXT,
    notes TEXT,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_package_consumptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_service_package_id UUID NOT NULL REFERENCES patient_service_packages(id) ON DELETE CASCADE,
    package_item_id UUID REFERENCES service_package_items(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    order_leistung_id UUID REFERENCES order_leistungen(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    overage_quantity NUMERIC NOT NULL DEFAULT 0,
    requires_patient_approval BOOLEAN NOT NULL DEFAULT false,
    approval_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (approval_status IN ('not_required', 'pending', 'approved', 'declined')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_service_packages
    BEFORE UPDATE ON service_packages
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_patient_service_packages
    BEFORE UPDATE ON patient_service_packages
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_service_package_items_package
    ON service_package_items(package_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_patient_service_packages_patient
    ON patient_service_packages(patient_id, status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_service_packages_order
    ON patient_service_packages(order_id)
    WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_package_consumptions_subscription
    ON service_package_consumptions(patient_service_package_id, consumed_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_package_consumptions_order_line
    ON service_package_consumptions(order_leistung_id)
    WHERE order_leistung_id IS NOT NULL;
