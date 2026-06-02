-- Prevent duplicate OPEN reminders for the same (appointment, user, title).
-- Appointment edits/assignments re-create the same reminder; without a uniqueness
-- guard they accumulate (the reported "13 duplicates"). create_reminder_record
-- dedups on read, but this closes the create-time / concurrent-request gap.

-- 1. Close pre-existing open duplicates, keeping the most recent per group, so the
--    unique index below can be created safely on existing data.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY appointment_id, user_id, title
               ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM reminders
    WHERE is_completed = false
)
UPDATE reminders r
SET is_completed = true,
    completed_at = now()
FROM ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

-- 2. Enforce uniqueness for open reminders going forward. (NULL appointment_id rows
--    remain distinct under standard NULL semantics, which is fine — the duplication
--    problem is appointment-scoped.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_reminder_per_user_apt
    ON reminders (appointment_id, user_id, title)
    WHERE is_completed = false;
