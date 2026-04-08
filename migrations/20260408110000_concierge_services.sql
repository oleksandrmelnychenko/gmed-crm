CREATE TABLE concierge_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    assigned_concierge_id UUID REFERENCES users(id),
    service_kind TEXT NOT NULL CHECK (
        service_kind IN (
            'hotel',
            'transfer',
            'vip_terminal',
            'flight',
            'chauffeur',
            'translation_support',
            'other'
        )
    ),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (
        status IN (
            'planned',
            'booked',
            'confirmed',
            'in_service',
            'completed',
            'cancelled'
        )
    ),
    booking_reference TEXT,
    vendor_name TEXT,
    vendor_contact TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    cost_estimate NUMERIC(12, 2),
    actual_cost NUMERIC(12, 2),
    currency TEXT NOT NULL DEFAULT 'EUR',
    billing_status TEXT NOT NULL DEFAULT 'draft' CHECK (
        billing_status IN (
            'draft',
            'ready',
            'billed',
            'settled',
            'waived'
        )
    ),
    service_notes TEXT,
    billing_notes TEXT,
    completed_at TIMESTAMPTZ,
    billed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_concierge_services_patient ON concierge_services(patient_id);
CREATE INDEX idx_concierge_services_appointment ON concierge_services(appointment_id);
CREATE INDEX idx_concierge_services_provider ON concierge_services(provider_id);
CREATE INDEX idx_concierge_services_assignee ON concierge_services(assigned_concierge_id);
CREATE INDEX idx_concierge_services_status ON concierge_services(status);
CREATE INDEX idx_concierge_services_billing_status ON concierge_services(billing_status);
CREATE INDEX idx_concierge_services_starts_at ON concierge_services(starts_at);

CREATE TRIGGER set_updated_at_concierge_services
    BEFORE UPDATE ON concierge_services
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
