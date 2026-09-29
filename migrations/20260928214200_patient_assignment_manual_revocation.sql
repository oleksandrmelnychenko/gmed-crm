-- A manager's revocation of a patient link is remembered. Booking an
-- interpreter (or the interpreter accepting a booking) used to re-grant the
-- link a manager had explicitly taken away. Now a booking re-grants a revoked
-- link only when its current revocation was not a manual one; a manager's new
-- assignment (or any other grant) clears it.
--
-- `manually_revoked_at` equals `revoked_at` while the current revocation is the
-- manual one: both are set by the same statement. Any later grant clears
-- `revoked_at`, and any later automatic revocation sets a different
-- `revoked_at`, so the manual mark stops applying without further bookkeeping.
ALTER TABLE patient_assignments
    ADD COLUMN IF NOT EXISTS manually_revoked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(id);

COMMENT ON COLUMN patient_assignments.manually_revoked_at IS
    'Set together with revoked_at when a manager revokes the link by hand. While it equals revoked_at, interpreter bookings do not re-grant the link; a manual assignment does.';
COMMENT ON COLUMN patient_assignments.revoked_by IS
    'User who revoked the link, when a person did (manual revocation, deactivation of the user).';

-- Backfill: a revoked link whose revocation is the manager's revoke on record
-- (the audit event follows the revocation within minutes) counts as manually
-- revoked. Every marked link is audited in the same transaction.
WITH manual_revocations AS (
    SELECT DISTINCT ON (link.id)
           link.id, link.patient_id, link.user_id, link.revoked_at, revoke_event.user_id AS revoked_by
    FROM patient_assignments link
    JOIN audit_log revoke_event
      ON revoke_event.entity_type = 'patient'
     AND revoke_event.entity_id = link.patient_id
     AND revoke_event.action = 'revoke_assignment'
     AND revoke_event.context ->> 'revoked_user_id' = link.user_id::text
     AND revoke_event.created_at BETWEEN link.revoked_at
                                     AND link.revoked_at + interval '5 minutes'
    WHERE link.revoked_at IS NOT NULL
      AND link.manually_revoked_at IS NULL
    ORDER BY link.id, revoke_event.created_at
),
marked AS (
    UPDATE patient_assignments link
    SET manually_revoked_at = link.revoked_at,
        revoked_by = manual_revocations.revoked_by
    FROM manual_revocations
    WHERE link.id = manual_revocations.id
    RETURNING link.patient_id, link.user_id, link.revoked_at
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'mark_manual_patient_access_revocation',
       'patient',
       marked.patient_id,
       jsonb_build_object(
           'user_id', marked.user_id,
           'revoked_at', marked.revoked_at,
           'repair', '20260928214200_patient_assignment_manual_revocation'
       )
FROM marked;
