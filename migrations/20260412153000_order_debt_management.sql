CREATE TABLE order_debt_management (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (status IN (
            'not_required',
            'review_required',
            'payment_plan',
            'awaiting_payment',
            'escalated',
            'cleared'
        )),
    note TEXT,
    owner_user_id UUID REFERENCES users(id),
    next_review_at TIMESTAMPTZ,
    last_contact_at TIMESTAMPTZ,
    resolution_note TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_debt_management_status
    ON order_debt_management(status);

CREATE INDEX idx_order_debt_management_owner
    ON order_debt_management(owner_user_id);

CREATE INDEX idx_order_debt_management_next_review
    ON order_debt_management(next_review_at);

CREATE TRIGGER set_updated_at_order_debt_management
    BEFORE UPDATE ON order_debt_management
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
