-- Enforce at the database level that a patient cannot have two OPEN appointment
-- requests of the same type/care-path. The application-level EXISTS pre-check in
-- create_my_appointment_request is racy (TOCTOU): two concurrent requests can both
-- pass the check and insert. This partial unique index closes that window; the
-- handler maps the unique-violation to the existing 409 "already exists" response.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_patient_appointment_requests_open
    ON patient_appointment_requests (
        patient_id,
        requested_by,
        appointment_type,
        care_path_kind
    )
    WHERE status IN ('requested', 'approved');
