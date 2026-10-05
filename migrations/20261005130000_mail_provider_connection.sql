-- The agency's Mittaro e-mail connection, entered on the API connections page
-- (owner decision 2026-10-05: every external key on one page). The API key is
-- encrypted with the server key registry, like signature_provider_connection,
-- and never returned by an endpoint. A row takes precedence over the
-- GMED_MITTARO_* environment; a disabled row switches e-mail off even when the
-- environment still has a key.
CREATE TABLE mail_provider_connection (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    revision UUID NOT NULL,
    enabled BOOLEAN NOT NULL,
    sender TEXT,
    reply_to TEXT,
    ciphertext BYTEA,
    nonce BYTEA,
    key_id TEXT,
    updated_by UUID NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT enabled OR (sender IS NOT NULL AND ciphertext IS NOT NULL
        AND nonce IS NOT NULL AND key_id IS NOT NULL))
);
