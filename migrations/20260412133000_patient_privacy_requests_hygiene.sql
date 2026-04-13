UPDATE patient_privacy_requests
SET request_type = replace(replace(lower(trim(request_type)), '-', '_'), ' ', '_')
WHERE request_type IS NOT NULL
  AND request_type <> replace(replace(lower(trim(request_type)), '-', '_'), ' ', '_');

UPDATE patient_privacy_requests
SET source = COALESCE(NULLIF(replace(replace(lower(trim(source)), '-', '_'), ' ', '_'), ''), 'patient_request')
WHERE source IS NULL
   OR source <> COALESCE(NULLIF(replace(replace(lower(trim(source)), '-', '_'), ' ', '_'), ''), 'patient_request');

UPDATE patient_privacy_requests
SET status = CASE
    WHEN replace(replace(lower(trim(status)), '-', '_'), ' ', '_') = 'executed' THEN 'completed'
    WHEN replace(replace(lower(trim(status)), '-', '_'), ' ', '_') = 'hold' THEN 'retention_hold'
    ELSE COALESCE(NULLIF(replace(replace(lower(trim(status)), '-', '_'), ' ', '_'), ''), 'requested')
END
WHERE status IS NULL
   OR status <> CASE
       WHEN replace(replace(lower(trim(status)), '-', '_'), ' ', '_') = 'executed' THEN 'completed'
       WHEN replace(replace(lower(trim(status)), '-', '_'), ' ', '_') = 'hold' THEN 'retention_hold'
       ELSE COALESCE(NULLIF(replace(replace(lower(trim(status)), '-', '_'), ' ', '_'), ''), 'requested')
   END;

UPDATE patient_privacy_requests
SET requested_at = COALESCE(requested_at, created_at, now()),
    created_at = COALESCE(created_at, requested_at, now()),
    updated_at = COALESCE(updated_at, created_at, requested_at, now());

ALTER TABLE patient_privacy_requests
    ALTER COLUMN request_type SET NOT NULL,
    ALTER COLUMN source SET NOT NULL,
    ALTER COLUMN source SET DEFAULT 'patient_request',
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'requested',
    ALTER COLUMN requested_at SET NOT NULL,
    ALTER COLUMN requested_at SET DEFAULT now(),
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE patient_privacy_requests
    DROP CONSTRAINT IF EXISTS patient_privacy_requests_request_type_check,
    DROP CONSTRAINT IF EXISTS patient_privacy_requests_source_check,
    DROP CONSTRAINT IF EXISTS patient_privacy_requests_status_check;

ALTER TABLE patient_privacy_requests
    ADD CONSTRAINT patient_privacy_requests_request_type_check
        CHECK (request_type IN ('erasure', 'restriction', 'third_party_revoke')),
    ADD CONSTRAINT patient_privacy_requests_source_check
        CHECK (source IN ('patient_request', 'admin_intake', 'legal_hold')),
    ADD CONSTRAINT patient_privacy_requests_status_check
        CHECK (status IN ('requested', 'retention_hold', 'approved', 'rejected', 'completed'));

DROP INDEX IF EXISTS idx_patient_privacy_requests_patient;
DROP INDEX IF EXISTS idx_patient_privacy_requests_status;
DROP INDEX IF EXISTS idx_patient_privacy_requests_requested_by;
DROP INDEX IF EXISTS idx_patient_privacy_requests_open;

CREATE INDEX idx_patient_privacy_requests_patient
    ON patient_privacy_requests(patient_id, created_at DESC);

CREATE INDEX idx_patient_privacy_requests_status
    ON patient_privacy_requests(status, due_at, created_at DESC);

CREATE INDEX idx_patient_privacy_requests_requested_by
    ON patient_privacy_requests(requested_by, created_at DESC);

CREATE UNIQUE INDEX idx_patient_privacy_requests_open
    ON patient_privacy_requests(patient_id, request_type)
    WHERE status IN ('requested', 'retention_hold', 'approved');
