-- The assigned interpreter explains a "needs clarification" (or declined)
-- response; the patient manager reads it on the appointment.
ALTER TABLE appointments
    ADD COLUMN interpreter_response_comment TEXT,
    ADD CONSTRAINT appointments_interpreter_response_comment_length_check
        CHECK (
            interpreter_response_comment IS NULL
            OR char_length(interpreter_response_comment) BETWEEN 1 AND 1000
        );
