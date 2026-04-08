-- Token families & refresh tokens (2026 best-practice rotation model)
--
-- Model:
--   Login → creates token_family + first refresh_token
--   Refresh → rotates: old token invalidated, new token created (same family)
--   Reuse of invalidated token → entire family revoked (theft detection)
--   Logout → family revoked

-- ============================================
-- Token Families
-- ============================================
CREATE TABLE token_families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint TEXT,
    ip_address TEXT,
    user_agent TEXT,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    revoked_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_token_families_user ON token_families(user_id);
CREATE INDEX idx_token_families_active ON token_families(user_id) WHERE NOT is_revoked;

-- ============================================
-- Refresh Tokens (single-use, linked to family)
-- ============================================
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES token_families(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    is_used BOOLEAN NOT NULL DEFAULT false,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ============================================
-- MFA: backup codes
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes TEXT[];

-- ============================================
-- Active sessions view (convenience)
-- ============================================
CREATE OR REPLACE VIEW active_sessions AS
SELECT
    tf.id AS family_id,
    tf.user_id,
    u.email,
    u.name,
    u.role,
    tf.device_fingerprint,
    tf.ip_address,
    tf.user_agent,
    tf.created_at AS session_started,
    tf.last_activity_at,
    (SELECT COUNT(*) FROM refresh_tokens rt WHERE rt.family_id = tf.id AND NOT rt.is_used) AS pending_tokens
FROM token_families tf
JOIN users u ON u.id = tf.user_id
WHERE NOT tf.is_revoked
  AND EXISTS (
    SELECT 1 FROM refresh_tokens rt
    WHERE rt.family_id = tf.id
      AND NOT rt.is_used
      AND rt.expires_at > now()
  );

-- ============================================
-- Cleanup: auto-delete expired tokens (run via cron/job)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete expired refresh tokens
    DELETE FROM refresh_tokens WHERE expires_at < now() - INTERVAL '7 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Revoke families with no valid tokens
    UPDATE token_families SET is_revoked = true, revoked_reason = 'expired'
    WHERE NOT is_revoked
      AND NOT EXISTS (
        SELECT 1 FROM refresh_tokens rt
        WHERE rt.family_id = token_families.id
          AND NOT rt.is_used
          AND rt.expires_at > now()
      );

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
