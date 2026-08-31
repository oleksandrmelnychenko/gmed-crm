-- Accounts that existed when the security-boundary migration was installed
-- keep their current password and receive a fresh expiry window. Explicit
-- administrator-requested resets remain enforced.
WITH security_boundary AS (
    SELECT COALESCE(
        (SELECT installed_on
         FROM _sqlx_migrations
         WHERE version = 20260828120000),
        TIMESTAMPTZ '2026-08-28 12:00:00+00'
    ) AS installed_on
)
UPDATE users u
SET password_changed_at = now(),
    password_reset_required = false,
    updated_at = now()
FROM security_boundary sb
WHERE u.is_active
  AND u.created_at <= sb.installed_on
  AND NOT EXISTS (
      SELECT 1
      FROM audit_log al
      WHERE al.action = 'force_password_reset'
        AND al.entity_type = 'user'
        AND al.entity_id = u.id
  );
