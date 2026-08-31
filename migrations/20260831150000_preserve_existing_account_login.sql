-- Existing accounts created before password_changed_at was introduced keep
-- their current credentials. Only an explicit administrator action may force
-- a password reset for those users.
UPDATE users u
SET password_changed_at = COALESCE(u.created_at, u.updated_at, now()),
    updated_at = now()
WHERE u.is_active
  AND u.password_changed_at IS NULL;

UPDATE users u
SET password_reset_required = false,
    updated_at = now()
WHERE u.is_active
  AND u.password_reset_required
  AND NOT EXISTS (
      SELECT 1
      FROM audit_log al
      WHERE al.action = 'force_password_reset'
        AND al.entity_type = 'user'
        AND al.entity_id = u.id
  );
