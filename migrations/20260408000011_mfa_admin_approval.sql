ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS pending_logins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    ip_address      TEXT,
    user_agent      TEXT,
    device_info     JSONB,
    approved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_pending_logins_status ON pending_logins(status) WHERE status = 'pending';
CREATE INDEX idx_pending_logins_user ON pending_logins(user_id);
