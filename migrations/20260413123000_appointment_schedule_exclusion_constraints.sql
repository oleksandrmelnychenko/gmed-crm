CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Clear pre-existing overlap conflicts before installing the exclusion
-- constraints below. Cancels (never deletes) later-created rows that overlap
-- an earlier active row on any of the six scopes the constraints guard.
-- Ordered scan + per-row check reads the freshest status, so cascades
-- self-resolve (cancelling the middle row of a chain lets the tail stay).
-- Idempotent: rerunning finds nothing to cancel.
DO $$
DECLARE
    r RECORD;
    total INT := 0;
BEGIN
    FOR r IN
        SELECT id, patient_id, interpreter_id, doctor_id, date, time_start, time_end, created_at
        FROM appointments
        WHERE status <> 'cancelled'
        ORDER BY created_at, id
    LOOP
        IF EXISTS (
            SELECT 1 FROM appointments b
            WHERE b.id <> r.id
              AND b.status <> 'cancelled'
              AND (b.created_at, b.id) < (r.created_at, r.id)
              AND (
                  (r.time_start IS NOT NULL AND r.time_end IS NOT NULL
                   AND b.time_start IS NOT NULL AND b.time_end IS NOT NULL
                   AND b.patient_id = r.patient_id
                   AND tsrange(b.date::timestamp + b.time_start, b.date::timestamp + b.time_end, '[)')
                    && tsrange(r.date::timestamp + r.time_start, r.date::timestamp + r.time_end, '[)'))
               OR (r.time_start IS NOT NULL AND r.time_end IS NOT NULL AND r.interpreter_id IS NOT NULL
                   AND b.time_start IS NOT NULL AND b.time_end IS NOT NULL
                   AND b.interpreter_id = r.interpreter_id
                   AND tsrange(b.date::timestamp + b.time_start, b.date::timestamp + b.time_end, '[)')
                    && tsrange(r.date::timestamp + r.time_start, r.date::timestamp + r.time_end, '[)'))
               OR (r.time_start IS NOT NULL AND r.time_end IS NOT NULL AND r.doctor_id IS NOT NULL
                   AND b.time_start IS NOT NULL AND b.time_end IS NOT NULL
                   AND b.doctor_id = r.doctor_id
                   AND tsrange(b.date::timestamp + b.time_start, b.date::timestamp + b.time_end, '[)')
                    && tsrange(r.date::timestamp + r.time_start, r.date::timestamp + r.time_end, '[)'))
               OR (r.time_start IS NULL AND r.time_end IS NULL
                   AND b.time_start IS NULL AND b.time_end IS NULL
                   AND b.patient_id = r.patient_id
                   AND daterange(b.date, b.date + 1, '[)') && daterange(r.date, r.date + 1, '[)'))
               OR (r.time_start IS NULL AND r.time_end IS NULL AND r.interpreter_id IS NOT NULL
                   AND b.time_start IS NULL AND b.time_end IS NULL
                   AND b.interpreter_id = r.interpreter_id
                   AND daterange(b.date, b.date + 1, '[)') && daterange(r.date, r.date + 1, '[)'))
               OR (r.time_start IS NULL AND r.time_end IS NULL AND r.doctor_id IS NOT NULL
                   AND b.time_start IS NULL AND b.time_end IS NULL
                   AND b.doctor_id = r.doctor_id
                   AND daterange(b.date, b.date + 1, '[)') && daterange(r.date, r.date + 1, '[)'))
              )
        ) THEN
            UPDATE appointments SET
                status = 'cancelled',
                notes = COALESCE(notes || E'\n', '') || '[auto-cancelled by migration 20260413123000: overlaps an earlier active appointment]',
                updated_at = now()
            WHERE id = r.id;
            total := total + 1;
        END IF;
    END LOOP;

    IF total > 0 THEN
        RAISE NOTICE 'migration 20260413123000: auto-cancelled % overlapping appointment(s) to satisfy new exclusion constraints', total;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_patient_timed_schedule_excl'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_patient_timed_schedule_excl
            EXCLUDE USING gist (
                patient_id WITH =,
                tsrange(
                    (date::timestamp + time_start),
                    (date::timestamp + time_end),
                    '[)'
                ) WITH &&
            )
            WHERE (
                status <> 'cancelled'
                AND time_start IS NOT NULL
                AND time_end IS NOT NULL
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_interpreter_timed_schedule_excl'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_interpreter_timed_schedule_excl
            EXCLUDE USING gist (
                interpreter_id WITH =,
                tsrange(
                    (date::timestamp + time_start),
                    (date::timestamp + time_end),
                    '[)'
                ) WITH &&
            )
            WHERE (
                status <> 'cancelled'
                AND interpreter_id IS NOT NULL
                AND time_start IS NOT NULL
                AND time_end IS NOT NULL
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_doctor_timed_schedule_excl'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_doctor_timed_schedule_excl
            EXCLUDE USING gist (
                doctor_id WITH =,
                tsrange(
                    (date::timestamp + time_start),
                    (date::timestamp + time_end),
                    '[)'
                ) WITH &&
            )
            WHERE (
                status <> 'cancelled'
                AND doctor_id IS NOT NULL
                AND time_start IS NOT NULL
                AND time_end IS NOT NULL
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_patient_all_day_schedule_excl'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_patient_all_day_schedule_excl
            EXCLUDE USING gist (
                patient_id WITH =,
                daterange(date, date + 1, '[)') WITH &&
            )
            WHERE (
                status <> 'cancelled'
                AND time_start IS NULL
                AND time_end IS NULL
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_interpreter_all_day_schedule_excl'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_interpreter_all_day_schedule_excl
            EXCLUDE USING gist (
                interpreter_id WITH =,
                daterange(date, date + 1, '[)') WITH &&
            )
            WHERE (
                status <> 'cancelled'
                AND interpreter_id IS NOT NULL
                AND time_start IS NULL
                AND time_end IS NULL
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_doctor_all_day_schedule_excl'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_doctor_all_day_schedule_excl
            EXCLUDE USING gist (
                doctor_id WITH =,
                daterange(date, date + 1, '[)') WITH &&
            )
            WHERE (
                status <> 'cancelled'
                AND doctor_id IS NOT NULL
                AND time_start IS NULL
                AND time_end IS NULL
            );
    END IF;
END $$;
