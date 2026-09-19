-- Time-based one-time passwords (RFC 6238) as a real second factor. The
-- existing "MFA" is an administrator approving the login; it does not prove
-- that the person holds a second device. The secret is sealed with the message
-- key registry, never stored in clear.
CREATE TABLE user_totp (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_ciphertext BYTEA NOT NULL,
    secret_nonce BYTEA NOT NULL,
    secret_key_id TEXT NOT NULL,
    confirmed_at TIMESTAMPTZ,
    -- Highest 30-second step already accepted: a code can never be replayed.
    last_used_step BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Password checked, code still owed. Short-lived and single use.
CREATE TABLE totp_login_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    device_info JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_totp_login_challenges_expiry ON totp_login_challenges (expires_at);

INSERT INTO system_settings (key, value, description) VALUES
    ('mfa_totp_required_roles', '["ceo", "it_admin", "patient_manager"]',
     'Roles that must enrol an authenticator app; they see a blocking reminder until they do')
ON CONFLICT (key) DO NOTHING;
