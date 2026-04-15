CREATE TABLE external_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    external_invoice_number TEXT NOT NULL,
    invoice_date DATE,
    due_date DATE,
    amount_net NUMERIC NOT NULL DEFAULT 0,
    amount_vat NUMERIC NOT NULL DEFAULT 0,
    amount_gross NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'expected'
        CHECK (status IN ('expected', 'received', 'approved', 'paid', 'overdue', 'cancelled')),
    received_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, external_invoice_number)
);

CREATE INDEX idx_external_invoices_order
    ON external_invoices(order_id, created_at DESC);

CREATE INDEX idx_external_invoices_status_due
    ON external_invoices(status, due_date);

CREATE INDEX idx_external_invoices_patient
    ON external_invoices(patient_id, created_at DESC);

CREATE TRIGGER set_updated_at_external_invoices
    BEFORE UPDATE ON external_invoices
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
