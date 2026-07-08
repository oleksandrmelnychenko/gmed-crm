-- Order amount amendments under approval (#10). When work runs over the planned
-- amount (e.g. 2h/50€ planned but 5h actual), a manager records a proposed
-- delta plus WHAT was agreed with the patient; it takes effect on the order
-- total only after an approver signs off — with a full who/what trail so
-- management can react in time.
CREATE TABLE order_amendments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    delta_amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    agreed_note TEXT NOT NULL CHECK (btrim(agreed_note) <> ''),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by UUID NOT NULL REFERENCES users(id),
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_amendments_order
    ON order_amendments (order_id, created_at DESC);
CREATE INDEX idx_order_amendments_pending
    ON order_amendments (order_id)
    WHERE status = 'pending';

CREATE TRIGGER set_updated_at_order_amendments
    BEFORE UPDATE ON order_amendments
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
