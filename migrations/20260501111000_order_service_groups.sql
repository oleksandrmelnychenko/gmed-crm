CREATE TABLE IF NOT EXISTS order_service_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    group_title TEXT NOT NULL,
    service_key TEXT,
    agency_service_id UUID REFERENCES agency_service_catalog(id) ON DELETE SET NULL,
    description TEXT,
    service_date DATE,
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    vat_rate NUMERIC NOT NULL DEFAULT 19,
    tax_profile_id UUID REFERENCES tax_profiles(id) ON DELETE SET NULL,
    vat_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (vat_source IN ('catalog', 'tax_profile', 'manual', 'legacy')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'ready', 'generated', 'cancelled')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_service_groups_order
    ON order_service_groups(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_service_groups_appointment
    ON order_service_groups(appointment_id)
    WHERE appointment_id IS NOT NULL;

CREATE TRIGGER set_updated_at_order_service_groups
    BEFORE UPDATE ON order_service_groups
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS order_service_group_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_group_id UUID NOT NULL REFERENCES order_service_groups(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    doctor_id UUID NOT NULL REFERENCES provider_doctors(id) ON DELETE RESTRICT,
    role_label TEXT,
    quantity_override NUMERIC,
    unit_price_override NUMERIC,
    description_override TEXT,
    external_invoice_id UUID REFERENCES external_invoices(id) ON DELETE SET NULL,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    generated_leistung_id UUID REFERENCES order_leistungen(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_service_group_participants_unique_doctor
    ON order_service_group_participants(service_group_id, doctor_id)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_order_service_group_participants_group
    ON order_service_group_participants(service_group_id, is_active);

CREATE TABLE IF NOT EXISTS appointment_doctor_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    doctor_id UUID NOT NULL REFERENCES provider_doctors(id) ON DELETE RESTRICT,
    role_label TEXT,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_doctor_participants_unique_doctor
    ON appointment_doctor_participants(appointment_id, doctor_id);

ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS source_service_group_id UUID REFERENCES order_service_groups(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_service_group_participant_id UUID REFERENCES order_service_group_participants(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ol_source_service_group_participant
    ON order_leistungen(source_service_group_participant_id)
    WHERE source_service_group_participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ol_source_service_group
    ON order_leistungen(source_service_group_id)
    WHERE source_service_group_id IS NOT NULL;

ALTER TABLE external_invoices
    ADD COLUMN IF NOT EXISTS source_service_group_id UUID REFERENCES order_service_groups(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_service_group_participant_id UUID REFERENCES order_service_group_participants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS order_leistung_id UUID REFERENCES order_leistungen(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_external_invoices_service_group
    ON external_invoices(source_service_group_id)
    WHERE source_service_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_invoices_service_group_participant
    ON external_invoices(source_service_group_participant_id)
    WHERE source_service_group_participant_id IS NOT NULL;
