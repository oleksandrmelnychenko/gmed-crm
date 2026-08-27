-- Fence Medication AI workers with a unique token per claim. A worker may
-- publish a transition only while it still owns the unexpired lease.

ALTER TABLE medication_ai_analyses
    ADD COLUMN lease_token UUID;

-- Applying this migration may interrupt an external request. Return every
-- in-flight job to the queue and refund that interrupted attempt; the old
-- worker is fenced out by the status change and the event-state trigger below.
WITH requeued AS (
    UPDATE medication_ai_analyses
    SET status = 'requested',
        started_at = NULL,
        lease_until = NULL,
        lease_token = NULL,
        attempts = GREATEST(attempts - 1, 0)::SMALLINT,
        available_at = now() + interval '10 seconds',
        updated_at = now()
    WHERE status = 'processing'
    RETURNING id
)
INSERT INTO medication_ai_analysis_events
    (analysis_id, from_status, to_status, reason_code)
SELECT id, 'processing', 'requested', 'lease_fencing_migration'
FROM requeued;

ALTER TABLE medication_ai_analyses
    DROP CONSTRAINT medication_ai_analysis_state_shape;

ALTER TABLE medication_ai_analyses
    ADD CONSTRAINT medication_ai_analysis_state_shape CHECK (
        (status = 'requested'
            AND started_at IS NULL AND completed_at IS NULL
            AND lease_until IS NULL AND lease_token IS NULL
            AND output_json IS NULL AND output_fingerprint IS NULL
            AND provider_response_id IS NULL AND provider_response_model IS NULL
            AND error_code IS NULL)
        OR (status = 'processing'
            AND started_at IS NOT NULL AND completed_at IS NULL
            AND lease_until IS NOT NULL AND lease_token IS NOT NULL
            AND output_json IS NULL AND output_fingerprint IS NULL
            AND provider_response_id IS NULL AND provider_response_model IS NULL
            AND error_code IS NULL)
        OR (status = 'ready'
            AND started_at IS NOT NULL AND completed_at IS NOT NULL
            AND lease_until IS NULL AND lease_token IS NULL
            AND output_json IS NOT NULL AND output_fingerprint IS NOT NULL
            AND provider_response_id IS NOT NULL AND provider_response_model IS NOT NULL
            AND error_code IS NULL)
        OR (status = 'failed'
            AND completed_at IS NOT NULL
            AND lease_until IS NULL AND lease_token IS NULL
            AND output_json IS NULL AND output_fingerprint IS NULL
            AND provider_response_id IS NULL AND provider_response_model IS NULL
            AND error_code IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION medication_ai_analysis_event_state_guard()
RETURNS TRIGGER AS $$
DECLARE
    current_status TEXT;
    previous_status TEXT;
    has_previous_event BOOLEAN := FALSE;
BEGIN
    SELECT status INTO current_status
    FROM medication_ai_analyses
    WHERE id = NEW.analysis_id
    FOR UPDATE;

    IF current_status IS DISTINCT FROM NEW.to_status THEN
        RAISE EXCEPTION
            'medication AI event target status % does not match analysis status %',
            NEW.to_status, current_status;
    END IF;

    SELECT TRUE, to_status
    INTO has_previous_event, previous_status
    FROM medication_ai_analysis_events
    WHERE analysis_id = NEW.analysis_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF NEW.from_status IS NULL THEN
        IF COALESCE(has_previous_event, FALSE) THEN
            RAISE EXCEPTION 'initial medication AI event already exists';
        END IF;
    ELSIF NOT COALESCE(has_previous_event, FALSE)
       OR previous_status IS DISTINCT FROM NEW.from_status THEN
        RAISE EXCEPTION
            'medication AI event source status % does not follow previous status %',
            NEW.from_status, previous_status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_ai_analysis_event_state_guard
    BEFORE INSERT ON medication_ai_analysis_events
    FOR EACH ROW EXECUTE FUNCTION medication_ai_analysis_event_state_guard();

COMMENT ON COLUMN medication_ai_analyses.lease_token IS
    'Unique fencing token for the current processing claim; NULL outside processing.';
