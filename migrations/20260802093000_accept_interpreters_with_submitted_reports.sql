UPDATE appointments AS appointment
SET interpreter_response = 'accepted',
    updated_at = now()
WHERE appointment.interpreter_id IS NOT NULL
  AND appointment.interpreter_response IS DISTINCT FROM 'accepted'
  AND EXISTS (
      SELECT 1
      FROM interpreter_reports AS report
      WHERE report.appointment_id = appointment.id
        AND report.interpreter_id = appointment.interpreter_id
        AND report.approval_status IN ('pending', 'approved')
  );
