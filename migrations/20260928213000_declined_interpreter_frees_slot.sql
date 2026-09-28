-- An interpreter who declined a booking stays on the appointment until a
-- coordinator books someone else, but no longer works that slot: the declined
-- booking must not block another booking of the same interpreter at that time
-- (owner decision 2026-09-28). The server-side overlap check and the booking
-- counters skip declined bookings too. If the interpreter later accepts the
-- declined booking again, this constraint rejects the answer when the slot has
-- been taken in the meantime.
--
-- Only the WHERE clause of the interpreter exclusion constraint changes; it
-- becomes less strict, so existing rows cannot violate it.
ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS appointments_interpreter_schedule_excl;

ALTER TABLE appointments
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
        WHERE (
            status <> 'cancelled'
            AND interpreter_id IS NOT NULL
            AND interpreter_response IS DISTINCT FROM 'declined'
        )
        DEFERRABLE INITIALLY IMMEDIATE;
