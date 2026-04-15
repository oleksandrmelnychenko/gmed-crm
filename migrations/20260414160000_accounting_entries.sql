CREATE TABLE accounting_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_kind TEXT NOT NULL CHECK (
        entry_kind IN ('invoice_payment', 'external_invoice_payment')
    ),
    direction TEXT NOT NULL CHECK (
        direction IN ('income', 'expense')
    ),
    category TEXT NOT NULL CHECK (
        category IN (
            'service_revenue',
            'cost_passthrough_revenue',
            'provider_expense'
        )
    ),
    source_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    source_external_invoice_id UUID REFERENCES external_invoices(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    entry_date DATE NOT NULL,
    description TEXT NOT NULL,
    amount_net NUMERIC NOT NULL DEFAULT 0,
    amount_vat NUMERIC NOT NULL DEFAULT 0,
    amount_gross NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounting_entries_date
    ON accounting_entries(entry_date DESC, created_at DESC);

CREATE INDEX idx_accounting_entries_invoice
    ON accounting_entries(source_invoice_id, entry_date DESC)
    WHERE source_invoice_id IS NOT NULL;

CREATE INDEX idx_accounting_entries_external_invoice
    ON accounting_entries(source_external_invoice_id, entry_date DESC)
    WHERE source_external_invoice_id IS NOT NULL;

CREATE INDEX idx_accounting_entries_order
    ON accounting_entries(order_id, entry_date DESC)
    WHERE order_id IS NOT NULL;

CREATE INDEX idx_accounting_entries_category
    ON accounting_entries(category, entry_date DESC);
