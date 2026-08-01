-- Assignment and update notifications were historically stored as actionable reminders
-- with an immediate due date. Keep the audit history, but remove them from operational queues.
UPDATE reminders
SET is_completed = true,
    completed_at = COALESCE(completed_at, now())
WHERE is_completed = false
  AND (
       title LIKE 'New assignment:%'
       OR title LIKE 'Appointment updated:%'
  );
