-- Appointment checklist items and reminders that close because the work no
-- longer applies (the appointment was cancelled, the interpreter was taken
-- off the visit, the automatic concierge workflow was closed) used to look
-- exactly like completed ones. They stay closed (is_completed, so they block
-- nothing), and closed_reason now tells them apart from real completion
-- (owner decision 2026-09-28). completed_by / completed_at keep who closed
-- them and when; reopening does not exist for either.
ALTER TABLE appointment_checklists
    ADD COLUMN closed_reason TEXT,
    ADD CONSTRAINT appointment_checklists_closed_reason_check
        CHECK (
            closed_reason IS NULL
            OR closed_reason IN ('appointment_cancelled', 'concierge_workflow_closed')
        ),
    ADD CONSTRAINT appointment_checklists_closed_reason_state_check
        CHECK (closed_reason IS NULL OR is_completed);

ALTER TABLE reminders
    ADD COLUMN closed_reason TEXT,
    ADD CONSTRAINT reminders_closed_reason_check
        CHECK (
            closed_reason IS NULL
            OR closed_reason IN (
                'appointment_cancelled',
                'interpreter_unbooked',
                'concierge_workflow_closed'
            )
        ),
    ADD CONSTRAINT reminders_closed_reason_state_check
        CHECK (closed_reason IS NULL OR is_completed);

-- One-off repair of items closed by a cancellation before this change. The
-- cancellation closed them in the same transaction as it cancelled the
-- appointment, so their completion time is the transaction time that is also
-- the appointment's updated_at; items completed at any other moment were
-- completed by a person and stay completed. Every repaired row is audited in
-- this transaction; nothing is deleted.
WITH closed_items AS (
    UPDATE appointment_checklists item
    SET closed_reason = 'appointment_cancelled'
    FROM appointments a
    WHERE a.id = item.appointment_id
      AND a.status = 'cancelled'
      AND item.is_completed
      AND item.closed_reason IS NULL
      AND item.completed_at = a.updated_at
    RETURNING item.id, item.appointment_id, a.patient_id, item.completed_by, item.completed_at
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'mark_appointment_checklist_item_closed_without_completion',
       'appointment',
       closed_items.appointment_id,
       jsonb_build_object('closed_reason', NULL),
       jsonb_build_object('closed_reason', 'appointment_cancelled'),
       jsonb_build_object(
           'checklist_item_id', closed_items.id,
           'patient_id', closed_items.patient_id,
           'completed_by', closed_items.completed_by,
           'completed_at', closed_items.completed_at,
           'repair', '20260928213100_closed_without_completion'
       )
FROM closed_items;

WITH closed_reminders AS (
    UPDATE reminders reminder
    SET closed_reason = 'appointment_cancelled'
    FROM appointments a
    WHERE a.id = reminder.appointment_id
      AND a.status = 'cancelled'
      AND reminder.is_completed
      AND reminder.closed_reason IS NULL
      AND reminder.completed_at = a.updated_at
    RETURNING reminder.id, reminder.appointment_id, a.patient_id, reminder.user_id,
              reminder.completed_at
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'mark_reminder_closed_without_completion',
       'appointment',
       closed_reminders.appointment_id,
       jsonb_build_object('closed_reason', NULL),
       jsonb_build_object('closed_reason', 'appointment_cancelled'),
       jsonb_build_object(
           'reminder_id', closed_reminders.id,
           'patient_id', closed_reminders.patient_id,
           'recipient_id', closed_reminders.user_id,
           'completed_at', closed_reminders.completed_at,
           'repair', '20260928213100_closed_without_completion'
       )
FROM closed_reminders;
