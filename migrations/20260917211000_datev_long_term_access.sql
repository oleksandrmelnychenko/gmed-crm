-- DATEV's standard refresh token ends after 11 hours. The two-year token is
-- bound to one company (offline_access + datev:iam:client:<consultant>-<client>).
ALTER TABLE datev_read_connection
    ADD COLUMN long_term boolean NOT NULL DEFAULT false,
    ADD COLUMN bound_consultant integer,
    ADD COLUMN bound_client integer,
    ADD COLUMN connected_at timestamptz,
    ADD CONSTRAINT datev_read_connection_status CHECK (
        status IN ('disconnected', 'connected', 'reconnect_required', 'revocation_pending')
    ),
    ADD CONSTRAINT datev_read_connection_token_parts CHECK (
        (token_ciphertext IS NULL) = (token_nonce IS NULL)
        AND (token_ciphertext IS NULL) = (token_key_id IS NULL)
    ),
    ADD CONSTRAINT datev_read_connection_binding CHECK (
        (bound_consultant IS NULL) = (bound_client IS NULL)
        AND (NOT long_term OR bound_consultant IS NOT NULL)
    );
