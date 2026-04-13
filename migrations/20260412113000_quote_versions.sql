CREATE TABLE quote_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    quote_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
    total_net NUMERIC NOT NULL,
    total_vat NUMERIC NOT NULL,
    total_gross NUMERIC NOT NULL,
    valid_until DATE,
    paid_amount NUMERIC NOT NULL DEFAULT 0,
    paid_at TIMESTAMPTZ,
    line_items JSONB NOT NULL DEFAULT '[]',
    notes TEXT,
    change_reason TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_quote_versions_unique_version
    ON quote_versions(quote_id, version_number);

CREATE INDEX idx_quote_versions_quote
    ON quote_versions(quote_id, created_at DESC);
