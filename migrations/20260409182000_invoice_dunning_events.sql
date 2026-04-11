CREATE TABLE invoice_dunning_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('first', 'second', 'collections')),
    note TEXT,
    due_date_snapshot DATE,
    balance_due NUMERIC NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_invoice_dunning_unique_level
    ON invoice_dunning_events(invoice_id, level);

CREATE INDEX idx_invoice_dunning_invoice
    ON invoice_dunning_events(invoice_id, sent_at DESC);
