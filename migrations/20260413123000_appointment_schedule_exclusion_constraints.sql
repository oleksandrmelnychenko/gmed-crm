CREATE EXTENSION IF NOT EXISTS btree_gist;

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
