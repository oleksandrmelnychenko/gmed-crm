CREATE TABLE IF NOT EXISTS user_message_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL UNIQUE,
    algorithm TEXT NOT NULL
        CHECK (algorithm IN ('p256-hkdf-aes256gcm-v1')),
    public_key BYTEA NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_message_keys_user
    ON user_message_keys(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_message_keys_active
    ON user_message_keys(user_id)
    WHERE is_active = true AND revoked_at IS NULL;

ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS e2e_algorithm TEXT
        CHECK (e2e_algorithm IS NULL OR e2e_algorithm IN ('p256-hkdf-aes256gcm-v1')),
    ADD COLUMN IF NOT EXISTS e2e_ciphertext BYTEA,
    ADD COLUMN IF NOT EXISTS e2e_nonce BYTEA,
    ADD COLUMN IF NOT EXISTS e2e_salt BYTEA,
    ADD COLUMN IF NOT EXISTS sender_key_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS recipient_key_fingerprint TEXT;
