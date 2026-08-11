-- Preserve whether a laboratory observation came from a calendar date or an
-- exact instant. Existing rows were created as timestamped observations.

ALTER TABLE patient_lab_results
    ADD COLUMN IF NOT EXISTS measured_at_precision TEXT NOT NULL DEFAULT 'datetime';

ALTER TABLE patient_lab_results
    ADD CONSTRAINT patient_lab_results_measured_at_precision_check CHECK (
        measured_at_precision IN ('date', 'datetime')
    );
