-- External provider staff and external interpreter profiles are contact records,
-- not CRM login users. Deactivate any legacy accounts that were created before
-- the login/listing gate existed, and revoke their outstanding sessions.

WITH blocked_users AS (
    SELECT u.id
    FROM users u
    WHERE (
        EXISTS (
            SELECT 1
            FROM provider_person_contacts pc
            JOIN provider_staff s ON s.id = pc.staff_id
            WHERE pc.contact_kind = 'email'
              AND lower(btrim(pc.value)) = lower(btrim(u.email))
              AND s.status IN ('external', 'unknown')
        )
        AND NOT EXISTS (
            SELECT 1
            FROM provider_person_contacts pc
            JOIN provider_staff s ON s.id = pc.staff_id
            WHERE pc.contact_kind = 'email'
              AND lower(btrim(pc.value)) = lower(btrim(u.email))
              AND s.status IN ('active', 'inactive')
        )
    )
    OR (
        u.role IN ('interpreter', 'teamlead_interpreter')
        AND (
            EXISTS (
                SELECT 1
                FROM interpreter_profile_details d
                WHERE d.user_id = u.id
                  AND d.employment_kind = 'external'
            )
            OR EXISTS (
                SELECT 1
                FROM interpreter_profiles p
                WHERE p.user_id = u.id
                  AND p.profile->>'employmentKind' = 'external'
            )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM interpreter_standalone_profiles sp
        WHERE sp.email IS NOT NULL
          AND lower(btrim(sp.email)) = lower(btrim(u.email))
          AND COALESCE(sp.profile->>'employmentKind', 'external') = 'external'
    )
)
UPDATE users u
SET is_active = false,
    updated_at = now()
FROM blocked_users b
WHERE u.id = b.id
  AND u.is_active = true;

WITH blocked_users AS (
    SELECT u.id
    FROM users u
    WHERE (
        EXISTS (
            SELECT 1
            FROM provider_person_contacts pc
            JOIN provider_staff s ON s.id = pc.staff_id
            WHERE pc.contact_kind = 'email'
              AND lower(btrim(pc.value)) = lower(btrim(u.email))
              AND s.status IN ('external', 'unknown')
        )
        AND NOT EXISTS (
            SELECT 1
            FROM provider_person_contacts pc
            JOIN provider_staff s ON s.id = pc.staff_id
            WHERE pc.contact_kind = 'email'
              AND lower(btrim(pc.value)) = lower(btrim(u.email))
              AND s.status IN ('active', 'inactive')
        )
    )
    OR (
        u.role IN ('interpreter', 'teamlead_interpreter')
        AND (
            EXISTS (
                SELECT 1
                FROM interpreter_profile_details d
                WHERE d.user_id = u.id
                  AND d.employment_kind = 'external'
            )
            OR EXISTS (
                SELECT 1
                FROM interpreter_profiles p
                WHERE p.user_id = u.id
                  AND p.profile->>'employmentKind' = 'external'
            )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM interpreter_standalone_profiles sp
        WHERE sp.email IS NOT NULL
          AND lower(btrim(sp.email)) = lower(btrim(u.email))
          AND COALESCE(sp.profile->>'employmentKind', 'external') = 'external'
    )
)
UPDATE token_families tf
SET is_revoked = true,
    revoked_reason = 'external_staff_account_deactivated'
FROM blocked_users b
WHERE tf.user_id = b.id
  AND tf.is_revoked = false;

WITH blocked_users AS (
    SELECT u.id
    FROM users u
    WHERE (
        EXISTS (
            SELECT 1
            FROM provider_person_contacts pc
            JOIN provider_staff s ON s.id = pc.staff_id
            WHERE pc.contact_kind = 'email'
              AND lower(btrim(pc.value)) = lower(btrim(u.email))
              AND s.status IN ('external', 'unknown')
        )
        AND NOT EXISTS (
            SELECT 1
            FROM provider_person_contacts pc
            JOIN provider_staff s ON s.id = pc.staff_id
            WHERE pc.contact_kind = 'email'
              AND lower(btrim(pc.value)) = lower(btrim(u.email))
              AND s.status IN ('active', 'inactive')
        )
    )
    OR (
        u.role IN ('interpreter', 'teamlead_interpreter')
        AND (
            EXISTS (
                SELECT 1
                FROM interpreter_profile_details d
                WHERE d.user_id = u.id
                  AND d.employment_kind = 'external'
            )
            OR EXISTS (
                SELECT 1
                FROM interpreter_profiles p
                WHERE p.user_id = u.id
                  AND p.profile->>'employmentKind' = 'external'
            )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM interpreter_standalone_profiles sp
        WHERE sp.email IS NOT NULL
          AND lower(btrim(sp.email)) = lower(btrim(u.email))
          AND COALESCE(sp.profile->>'employmentKind', 'external') = 'external'
    )
)
UPDATE pending_logins pl
SET status = 'rejected',
    resolved_at = now()
FROM blocked_users b
WHERE pl.user_id = b.id
  AND pl.status = 'pending';
