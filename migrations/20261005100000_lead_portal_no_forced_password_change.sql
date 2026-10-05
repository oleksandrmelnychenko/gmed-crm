-- Owner decision 2026-10-05: a lead (or a parent filling in a minor's request)
-- signs in with the password the manager issued and is no longer stopped by
-- "new password required"; the lead cabinet does not offer a password change
-- either. New logins are created without the flag. This clears it for the
-- logins issued before, as long as they reach only requests: a login that
-- already belongs to a patient record keeps a pending forced change.
UPDATE users u
SET password_reset_required = false,
    updated_at = now()
WHERE u.role = 'patient'
  AND u.password_reset_required
  AND NOT EXISTS (
      SELECT 1 FROM patient_assignments pa
      WHERE pa.user_id = u.id AND pa.revoked_at IS NULL
  )
  AND (
      EXISTS (
          SELECT 1 FROM leads l
          WHERE l.portal_user_id = u.id
            AND l.qualification_status <> 'deleted'
            AND l.converted_patient_id IS NULL
      )
      OR EXISTS (
          SELECT 1 FROM lead_portal_access a
          JOIN leads l ON l.id = a.lead_id
          WHERE a.user_id = u.id
            AND a.kind = 'guardian'
            AND a.revoked_at IS NULL
            AND l.qualification_status <> 'deleted'
            AND l.converted_patient_id IS NULL
      )
  );
