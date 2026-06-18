-- Medication "on hold": the patient is temporarily NOT taking this medication.
-- Captured via a checkbox in the medication form that reveals an "until when"
-- date and a free-text note.

ALTER TABLE patient_medications
    ADD COLUMN on_hold BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN hold_until TEXT,
    ADD COLUMN hold_note TEXT;
