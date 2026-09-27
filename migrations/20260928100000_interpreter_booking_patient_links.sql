-- Booking an interpreter on an appointment links them to the patient (basic
-- card, released documents without an appointment, patient chat). Until now
-- such links never ended and looked like a manager's manual assignment.
-- A link now records why it exists: 'manual' (a manager or another staff
-- flow; never expires automatically) or 'interpreter_booking' (ends as soon
-- as the interpreter has no active booking on the patient's appointments, or
-- interpreter_booking_access_days after the last booked appointment; see
-- crates/server/src/services/interpreter_booking_links.rs).
ALTER TABLE patient_assignments
    ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
        CONSTRAINT patient_assignments_source_check
        CHECK (source IN ('manual', 'interpreter_booking'));

COMMENT ON COLUMN patient_assignments.source IS
    'manual: assigned by staff, never expires automatically; interpreter_booking: granted by booking the interpreter on an appointment of the patient, revoked when no active booking keeps it alive.';

CREATE INDEX idx_pa_active_booking_links
    ON patient_assignments (patient_id, user_id)
    WHERE source = 'interpreter_booking' AND revoked_at IS NULL;

CREATE INDEX idx_apt_patient_interpreter
    ON appointments (patient_id, interpreter_id)
    WHERE interpreter_id IS NOT NULL;

INSERT INTO system_settings (key, value, description)
VALUES (
    'interpreter_booking_access_days',
    '14',
    'Days after the last booked appointment that an interpreter keeps the patient link a booking granted'
)
ON CONFLICT (key) DO NOTHING;

-- Backfill: an active link becomes a booking link only when the data shows
-- it unambiguously.
-- 1. Its last grant was a booking: the user was booked as the interpreter of
--    one of the patient's appointments by the same staff member within
--    minutes of the grant (booking code re-granted the link with its own
--    assigned_by / assigned_at). The evidence is the appointment itself
--    (created with the interpreter) or the audit event of the booking.
-- 2. No manual assignment of the user to the patient is on record, and the
--    audit trail reaches back before the patient existed, so a manual
--    assignment could not have been purged by the retention.
-- Everything else stays manual. Every marked link is audited in the same
-- transaction; the sweep then ends the links no booking keeps alive.
WITH audit_horizon AS (
    SELECT created_at AS oldest_event
    FROM audit_log
    WHERE action <> 'http_request'
    ORDER BY created_at
    LIMIT 1
),
candidates AS (
    SELECT link.id
    FROM patient_assignments link
    JOIN patients patient ON patient.id = link.patient_id
    CROSS JOIN audit_horizon
    WHERE link.revoked_at IS NULL
      AND link.source = 'manual'
      AND audit_horizon.oldest_event <= patient.created_at
      AND NOT EXISTS (
          SELECT 1
          FROM audit_log manual
          WHERE manual.entity_type = 'patient'
            AND manual.entity_id = link.patient_id
            AND manual.action = 'assign_patient'
            AND manual.context ->> 'assigned_to' = link.user_id::text
      )
      AND (
          EXISTS (
              SELECT 1
              FROM appointments booking
              WHERE booking.patient_id = link.patient_id
                AND booking.interpreter_id = link.user_id
                AND booking.created_by = link.assigned_by
                AND link.assigned_at BETWEEN booking.created_at
                                         AND booking.created_at + interval '5 minutes'
          )
          OR EXISTS (
              SELECT 1
              FROM audit_log booking_event
              LEFT JOIN appointments booked
                ON booking_event.entity_type = 'appointment'
               AND booked.id = booking_event.entity_id
              WHERE booking_event.created_at BETWEEN link.assigned_at - interval '1 minute'
                                                 AND link.assigned_at + interval '5 minutes'
                AND booking_event.user_id = link.assigned_by
                AND booking_event.action IN (
                    'create_appointment',
                    'update_appointment',
                    'assign_interpreter',
                    'convert_appointment_request'
                )
                AND booking_event.context ->> 'interpreter_id' = link.user_id::text
                AND COALESCE(booked.patient_id::text, booking_event.context ->> 'patient_id')
                    = link.patient_id::text
          )
      )
),
marked AS (
    UPDATE patient_assignments link
    SET source = 'interpreter_booking'
    FROM candidates
    WHERE link.id = candidates.id
    RETURNING link.patient_id, link.user_id, link.assigned_by, link.assigned_at
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'mark_booking_patient_access',
       'patient',
       marked.patient_id,
       jsonb_build_object(
           'user_id', marked.user_id,
           'source', 'interpreter_booking',
           'assigned_by', marked.assigned_by,
           'assigned_at', marked.assigned_at,
           'repair', '20260928100000_interpreter_booking_patient_links'
       )
FROM marked;
