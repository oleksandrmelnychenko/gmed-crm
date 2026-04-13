-- Access token revocation list (aka blacklist/denylist).
--
-- When a user logs out or their refresh token family is revoked, we add
-- every outstanding access token's `jti` here. The auth middleware checks
-- this table on every request and rejects tokens present in it.
--
-- Rows self-expire after `expires_at` (= original JWT exp). A background
-- sweep removes expired rows periodically.

CREATE TABLE IF NOT EXISTS revoked_access_tokens (
    jti UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    family_id UUID NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL DEFAULT 'logout'
);

CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_expires
    ON revoked_access_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_family
    ON revoked_access_tokens (family_id);

CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_user
    ON revoked_access_tokens (user_id);
