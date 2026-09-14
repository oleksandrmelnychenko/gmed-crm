-- Short-lived edit leases prevent two staff members from changing the same
-- lead at once. A lease expires automatically if the browser disappears and
-- can therefore never leave a lead permanently locked.
CREATE TABLE lead_edit_leases (
    lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > acquired_at)
);

CREATE INDEX idx_lead_edit_leases_expiry
    ON lead_edit_leases(expires_at);
