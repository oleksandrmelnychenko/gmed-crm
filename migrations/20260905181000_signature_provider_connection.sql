-- Single agency connection. Secrets are encrypted using the server key registry,
-- never exposed through generic system-settings endpoints.
CREATE TABLE signature_provider_connection (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    revision UUID NOT NULL,
    enabled BOOLEAN NOT NULL,
    provider_account TEXT,
    ciphertext BYTEA,
    nonce BYTEA,
    key_id TEXT,
    updated_by UUID NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT enabled OR (provider_account IS NOT NULL AND ciphertext IS NOT NULL
        AND nonce IS NOT NULL AND key_id IS NOT NULL))
);
