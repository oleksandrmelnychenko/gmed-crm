CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    source TEXT,
    country TEXT,
    languages TEXT[] NOT NULL DEFAULT '{}',
    needs_medical TEXT,
    needs_non_medical TEXT,
    compliance_status TEXT NOT NULL DEFAULT 'pending' CHECK (compliance_status IN ('pending', 'documents_sent', 'signed', 'rejected')),
    qualification_status TEXT NOT NULL DEFAULT 'new' CHECK (qualification_status IN ('new', 'in_progress', 'qualified', 'not_qualified', 'converted', 'archived')),
    converted_patient_id UUID REFERENCES patients(id),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_status ON leads(qualification_status);
CREATE INDEX idx_leads_created ON leads(created_at);

CREATE TRIGGER set_updated_at_leads
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('medical', 'non_medical')),
    address_street TEXT,
    address_city TEXT,
    address_zip TEXT,
    address_country TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    fachbereich TEXT,
    kooperationsvertrag JSONB,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_providers_type ON providers(provider_type);
CREATE INDEX idx_providers_active ON providers(is_active) WHERE is_active;

CREATE TRIGGER set_updated_at_providers
    BEFORE UPDATE ON providers
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE provider_doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    title TEXT,
    fachbereich TEXT,
    phone TEXT,
    email TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pd_provider ON provider_doctors(provider_id);

CREATE TABLE service_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    service_name TEXT NOT NULL,
    description TEXT,
    price NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_provider ON service_catalog(provider_id);

CREATE TABLE framework_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    contract_number TEXT NOT NULL UNIQUE,
    signed_at TIMESTAMPTZ,
    valid_from DATE,
    valid_to DATE,
    conditions JSONB,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'expired', 'terminated')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fc_patient ON framework_contracts(patient_id);
CREATE SEQUENCE contract_number_seq START 1;

CREATE TRIGGER set_updated_at_fc
    BEFORE UPDATE ON framework_contracts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number TEXT NOT NULL UNIQUE,
    patient_id UUID NOT NULL REFERENCES patients(id),
    contract_id UUID REFERENCES framework_contracts(id),
    phase TEXT NOT NULL DEFAULT 'discovery' CHECK (phase IN ('discovery', 'intake', 'execution', 'closure', 'followup')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    needs_description TEXT,
    conditions JSONB,
    signed_patient BOOLEAN NOT NULL DEFAULT false,
    signed_agency BOOLEAN NOT NULL DEFAULT false,
    signed_at TIMESTAMPTZ,
    total_estimated NUMERIC,
    total_actual NUMERIC,
    currency TEXT NOT NULL DEFAULT 'EUR',
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_patient ON orders(patient_id);
CREATE INDEX idx_orders_phase ON orders(phase);
CREATE INDEX idx_orders_status ON orders(status);
CREATE SEQUENCE order_number_seq START 1;

CREATE TRIGGER set_updated_at_orders
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE order_leistungen (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit_price NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    vat_rate NUMERIC NOT NULL DEFAULT 19,
    is_cost_passthrough BOOLEAN NOT NULL DEFAULT false,
    provider_id UUID REFERENCES providers(id),
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'delivered', 'approved', 'invoiced')),
    delivered_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ol_order ON order_leistungen(order_id);
CREATE INDEX idx_ol_status ON order_leistungen(status);

CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    quote_number TEXT NOT NULL UNIQUE,
    total_net NUMERIC NOT NULL,
    total_vat NUMERIC NOT NULL,
    total_gross NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
    valid_until DATE,
    paid_amount NUMERIC NOT NULL DEFAULT 0,
    paid_at TIMESTAMPTZ,
    line_items JSONB NOT NULL DEFAULT '[]',
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quotes_order ON quotes(order_id);
CREATE SEQUENCE quote_number_seq START 1;

CREATE TRIGGER set_updated_at_quotes
    BEFORE UPDATE ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
