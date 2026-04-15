ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS care_path_kind TEXT NOT NULL DEFAULT 'regular'
    CHECK (care_path_kind IN ('regular', 'preventive', 'control', 'followup'));

CREATE INDEX IF NOT EXISTS idx_appointments_care_path_kind
    ON appointments(care_path_kind);

ALTER TABLE patient_appointment_requests
    ADD COLUMN IF NOT EXISTS care_path_kind TEXT NOT NULL DEFAULT 'regular'
    CHECK (care_path_kind IN ('regular', 'preventive', 'control', 'followup'));

CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_care_path_kind
    ON patient_appointment_requests(care_path_kind, requested_at DESC);
