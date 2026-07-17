-- Fail before changing constraints if legacy schedule data cannot satisfy the
-- new API invariant. These rows require an explicit operational decision; the
-- migration must not silently reinterpret or cancel a real appointment.
DO $$
DECLARE
    violation_count BIGINT;
    sample_ids TEXT;
BEGIN
    SELECT count(*),
           string_agg(id::text, ', ' ORDER BY created_at, id)
               FILTER (WHERE sample_rank <= 10)
    INTO violation_count, sample_ids
    FROM (
        SELECT id,
               created_at,
               row_number() OVER (ORDER BY created_at, id) AS sample_rank
        FROM appointments
        WHERE (time_start IS NULL) <> (time_end IS NULL)
           OR (
               time_start IS NOT NULL
               AND time_end IS NOT NULL
               AND time_end <= time_start
           )
    ) invalid_schedule;

    IF violation_count > 0 THEN
        RAISE EXCEPTION
            'appointments hardening preflight failed: % invalid time pair(s); sample appointment ids: %',
            violation_count,
            COALESCE(sample_ids, '(none)');
    END IF;
END $$;

ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS appointments_time_pair_check,
    DROP CONSTRAINT IF EXISTS appointments_time_order_check;

ALTER TABLE appointments
    ADD CONSTRAINT appointments_time_pair_check
        CHECK ((time_start IS NULL) = (time_end IS NULL)),
    ADD CONSTRAINT appointments_time_order_check
        CHECK (
            time_start IS NULL
            OR time_end IS NULL
            OR time_end > time_start
        );

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS recurrence_end_mode TEXT;

UPDATE appointments
SET recurrence_end_mode = 'count'
WHERE recurrence_series_id IS NOT NULL
  AND recurrence_end_mode IS NULL;

ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS appointments_recurrence_end_mode_check;

ALTER TABLE appointments
    ADD CONSTRAINT appointments_recurrence_end_mode_check
        CHECK (
            recurrence_end_mode IS NULL
            OR recurrence_end_mode IN ('count', 'until')
        );

CREATE OR REPLACE FUNCTION enforce_appointment_terminal_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status IN ('completed', 'cancelled')
       OR (
            NEW.status <> 'cancelled'
            AND CASE NEW.status
                    WHEN 'planned' THEN 0
                    WHEN 'confirmed' THEN 1
                    WHEN 'in_progress' THEN 2
                    WHEN 'completed' THEN 3
                    ELSE -1
                END
                < CASE OLD.status
                    WHEN 'planned' THEN 0
                    WHEN 'confirmed' THEN 1
                    WHEN 'in_progress' THEN 2
                    WHEN 'completed' THEN 3
                    ELSE 99
                  END
       ) THEN
        RAISE EXCEPTION
            'appointment status cannot transition from % to %',
            OLD.status,
            NEW.status
            USING
                ERRCODE = '23514',
                CONSTRAINT = 'appointments_terminal_status_transition_check';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_appointment_terminal_status_transition
    ON appointments;
CREATE TRIGGER enforce_appointment_terminal_status_transition
    BEFORE UPDATE OF status ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION enforce_appointment_terminal_status_transition();

-- The old constraints split timed and all-day rows, so they do not detect
-- cross-category conflicts. Preflight those conflicts before replacing them.
DO $$
DECLARE
    conflict_count BIGINT;
    conflict_samples TEXT;
BEGIN
    SELECT count(*),
           string_agg(
               format('%s<->%s', left_id, right_id),
               ', ' ORDER BY left_created_at, left_id, right_created_at, right_id
           ) FILTER (WHERE sample_rank <= 10)
    INTO conflict_count, conflict_samples
    FROM (
        SELECT earlier.id AS left_id,
               later.id AS right_id,
               earlier.created_at AS left_created_at,
               later.created_at AS right_created_at,
               row_number() OVER (
                   ORDER BY earlier.created_at, earlier.id, later.created_at, later.id
               ) AS sample_rank
        FROM appointments earlier
        JOIN appointments later
          ON (earlier.created_at, earlier.id) < (later.created_at, later.id)
         AND earlier.status <> 'cancelled'
         AND later.status <> 'cancelled'
         AND (
                earlier.patient_id = later.patient_id
             OR (
                    earlier.interpreter_id IS NOT NULL
                AND earlier.interpreter_id = later.interpreter_id
             )
             OR (
                    earlier.doctor_id IS NOT NULL
                AND earlier.doctor_id = later.doctor_id
             )
         )
         AND tsrange(
                earlier.date::timestamp
                    + COALESCE(earlier.time_start, time '00:00'),
                CASE
                    WHEN earlier.time_start IS NULL
                        THEN (earlier.date + 1)::timestamp
                    ELSE earlier.date::timestamp + earlier.time_end
                END,
                '[)'
             )
             && tsrange(
                later.date::timestamp
                    + COALESCE(later.time_start, time '00:00'),
                CASE
                    WHEN later.time_start IS NULL
                        THEN (later.date + 1)::timestamp
                    ELSE later.date::timestamp + later.time_end
                END,
                '[)'
             )
    ) conflicts;

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'appointments hardening preflight failed: % active schedule conflict pair(s); sample appointment pairs: %',
            conflict_count,
            COALESCE(conflict_samples, '(none)');
    END IF;
END $$;

ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS appointments_patient_timed_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_interpreter_timed_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_doctor_timed_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_patient_all_day_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_interpreter_all_day_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_doctor_all_day_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_patient_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_interpreter_schedule_excl,
    DROP CONSTRAINT IF EXISTS appointments_doctor_schedule_excl;

ALTER TABLE appointments
    ADD CONSTRAINT appointments_patient_schedule_excl
        EXCLUDE USING gist (
            patient_id WITH =,
            tsrange(
                date::timestamp + COALESCE(time_start, time '00:00'),
                CASE
                    WHEN time_start IS NULL THEN (date + 1)::timestamp
                    ELSE date::timestamp + time_end
                END,
                '[)'
            ) WITH &&
        )
        WHERE (status <> 'cancelled')
        DEFERRABLE INITIALLY IMMEDIATE,
    ADD CONSTRAINT appointments_interpreter_schedule_excl
        EXCLUDE USING gist (
            interpreter_id WITH =,
            tsrange(
                date::timestamp + COALESCE(time_start, time '00:00'),
                CASE
                    WHEN time_start IS NULL THEN (date + 1)::timestamp
                    ELSE date::timestamp + time_end
                END,
                '[)'
            ) WITH &&
        )
        WHERE (status <> 'cancelled' AND interpreter_id IS NOT NULL)
        DEFERRABLE INITIALLY IMMEDIATE,
    ADD CONSTRAINT appointments_doctor_schedule_excl
        EXCLUDE USING gist (
            doctor_id WITH =,
            tsrange(
                date::timestamp + COALESCE(time_start, time '00:00'),
                CASE
                    WHEN time_start IS NULL THEN (date + 1)::timestamp
                    ELSE date::timestamp + time_end
                END,
                '[)'
            ) WITH &&
        )
        WHERE (status <> 'cancelled' AND doctor_id IS NOT NULL)
        DEFERRABLE INITIALLY IMMEDIATE;

-- Approved reports may already be billed. Never rewrite or auto-reject them:
-- fail so an operator can reconcile the report and billing records explicitly.
DO $$
DECLARE
    violation_count BIGINT;
    sample_ids TEXT;
BEGIN
    SELECT count(*),
           string_agg(id::text, ', ' ORDER BY created_at, id)
               FILTER (WHERE sample_rank <= 10)
    INTO violation_count, sample_ids
    FROM (
        SELECT id,
               created_at,
               row_number() OVER (ORDER BY created_at, id) AS sample_rank
        FROM interpreter_reports
        WHERE approval_status = 'approved'
          AND (hours < 0.25 OR hours > 24 OR mod(hours, 0.25) <> 0)
    ) invalid_approved;

    IF violation_count > 0 THEN
        RAISE EXCEPTION
            'appointments hardening preflight failed: % approved report(s) have invalid hours; sample report ids: %',
            violation_count,
            COALESCE(sample_ids, '(none)');
    END IF;
END $$;

DO $$
DECLARE
    duplicate_count BIGINT;
    sample_appointments TEXT;
BEGIN
    SELECT count(*),
           string_agg(appointment_id::text, ', ' ORDER BY appointment_id)
               FILTER (WHERE sample_rank <= 10)
    INTO duplicate_count, sample_appointments
    FROM (
        SELECT appointment_id,
               row_number() OVER (ORDER BY appointment_id) AS sample_rank
        FROM interpreter_reports
        WHERE approval_status = 'approved'
        GROUP BY appointment_id
        HAVING count(*) > 1
    ) duplicate_approved;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION
            'appointments hardening preflight failed: % appointment(s) have multiple approved reports; sample appointment ids: %',
            duplicate_count,
            COALESCE(sample_appointments, '(none)');
    END IF;
END $$;

-- Invalid pending reports are not billable. Reject them without changing hours,
-- and retain the original value in notes for auditability.
UPDATE interpreter_reports
SET approval_status = 'rejected',
    notes = concat_ws(
        E'\n',
        NULLIF(notes, ''),
        format(
            '[rejected by migration 20260717110000: invalid pending hours=%s]',
            hours::text
        )
    ),
    updated_at = now()
WHERE approval_status = 'pending'
  AND (hours < 0.25 OR hours > 24 OR mod(hours, 0.25) <> 0);

-- If an approved report exists, all pending reports are older actionable
-- duplicates. Otherwise keep the newest valid pending report and reject the rest.
WITH ranked_pending AS (
    SELECT pending.id,
           row_number() OVER (
               PARTITION BY pending.appointment_id
               ORDER BY pending.created_at DESC, pending.id DESC
           ) AS pending_rank,
           EXISTS (
               SELECT 1
               FROM interpreter_reports approved
               WHERE approved.appointment_id = pending.appointment_id
                 AND approved.approval_status = 'approved'
           ) AS has_approved
    FROM interpreter_reports pending
    WHERE pending.approval_status = 'pending'
)
UPDATE interpreter_reports report
SET approval_status = 'rejected',
    notes = concat_ws(
        E'\n',
        NULLIF(report.notes, ''),
        '[rejected by migration 20260717110000: duplicate active report]'
    ),
    updated_at = now()
FROM ranked_pending
WHERE report.id = ranked_pending.id
  AND (ranked_pending.has_approved OR ranked_pending.pending_rank > 1);

ALTER TABLE interpreter_reports
    DROP CONSTRAINT IF EXISTS interpreter_reports_hours_check;

-- Rejected rows are immutable audit history and may contain a legacy invalid
-- value. Every actionable (pending/approved) report must satisfy the bound.
ALTER TABLE interpreter_reports
    ADD CONSTRAINT interpreter_reports_hours_check
        CHECK (
            approval_status = 'rejected'
            OR (
                hours >= 0.25
                AND hours <= 24
                AND mod(hours, 0.25) = 0
            )
        );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_interpreter_report_active_per_appointment
    ON interpreter_reports (appointment_id)
    WHERE approval_status IN ('pending', 'approved');
