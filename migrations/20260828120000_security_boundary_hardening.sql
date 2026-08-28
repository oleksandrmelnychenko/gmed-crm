-- One-time MFA approvals are short-lived and single-use.
ALTER TABLE pending_logins
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

UPDATE pending_logins
SET expires_at = created_at + INTERVAL '10 minutes'
WHERE expires_at IS NULL;

ALTER TABLE pending_logins
    ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '10 minutes'),
    ALTER COLUMN expires_at SET NOT NULL;

UPDATE pending_logins
SET status = 'expired', resolved_at = COALESCE(resolved_at, now())
WHERE status IN ('pending', 'approved')
  AND expires_at <= now();

CREATE INDEX IF NOT EXISTS idx_pending_logins_redeemable
    ON pending_logins(id, expires_at)
    WHERE status = 'approved' AND consumed_at IS NULL;

-- Explicit reset state is enforced by login and refresh. Password reset clears it.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT false;

-- A missing credential epoch cannot be compared safely at the final session
-- creation boundary. Require an administrator to replace such a password.
UPDATE users
SET password_reset_required = true,
    updated_at = now()
WHERE password_changed_at IS NULL;

-- The previous WebSocket protocol placed access JWTs in proxy access logs.
-- Rotate every pre-deployment family once so retained log entries cannot be
-- replayed after the fixed protocol ships.
INSERT INTO revoked_access_tokens (jti, user_id, family_id, expires_at, reason)
SELECT tf.id,
       '00000000-0000-0000-0000-000000000000'::uuid,
       tf.id,
       now() + INTERVAL '30 days',
       'websocket_query_token_rotation'
FROM token_families tf
WHERE NOT tf.is_revoked
ON CONFLICT (jti) DO NOTHING;

UPDATE token_families
SET is_revoked = true,
    revoked_reason = 'websocket_query_token_rotation'
WHERE NOT is_revoked;

-- Serialize refresh rotation at the database boundary as well as in code.
-- If a historical race produced siblings, retain only the newest unused token.
WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY family_id ORDER BY created_at DESC, id DESC) AS position
    FROM refresh_tokens
    WHERE NOT is_used
)
UPDATE refresh_tokens rt
SET is_used = true,
    used_at = COALESCE(used_at, now())
FROM ranked
WHERE rt.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_one_unused_per_family
    ON refresh_tokens(family_id)
    WHERE NOT is_used;

-- Historical migrations contain development credentials. Preserve migration
-- checksums, but make every still-known credential unusable before startup.
UPDATE users
SET is_active = false,
    password_reset_required = true,
    updated_at = now()
WHERE password_hash = '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ'
   OR (lower(email) = 'admin@gmed.de' AND password_hash = crypt('admin123', password_hash));

UPDATE token_families tf
SET is_revoked = true,
    revoked_reason = 'known_seed_credential_disabled'
FROM users u
WHERE tf.user_id = u.id
  AND u.password_reset_required = true
  AND NOT tf.is_revoked;

UPDATE pending_logins pl
SET status = 'rejected', resolved_at = COALESCE(resolved_at, now())
FROM users u
WHERE pl.user_id = u.id
  AND u.password_reset_required = true
  AND pl.status IN ('pending', 'approved');
