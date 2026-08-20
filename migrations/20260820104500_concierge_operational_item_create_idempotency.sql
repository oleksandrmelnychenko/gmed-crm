-- Make Concierge operational task/event creation safely retryable. The registry
-- is deliberately append-only so a request id can never be reused after a task
-- has been created, even by direct database maintenance.

CREATE TABLE concierge_operational_item_create_requests (
    request_id UUID PRIMARY KEY,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
    payload_fingerprint TEXT NOT NULL
        CHECK (char_length(payload_fingerprint) BETWEEN 1 AND 128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_concierge_operational_create_requests_actor
    ON concierge_operational_item_create_requests(actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION guard_concierge_operational_create_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM tasks
        WHERE id = NEW.task_id
          AND task_scope = 'concierge_operational'
    ) THEN
        RAISE EXCEPTION 'create request must reference an operational Concierge task';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_concierge_operational_create_request_scope
    BEFORE INSERT OR UPDATE OF task_id
    ON concierge_operational_item_create_requests
    FOR EACH ROW EXECUTE FUNCTION guard_concierge_operational_create_request();

CREATE OR REPLACE FUNCTION prevent_concierge_operational_create_request_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'concierge operational create requests are append-only';
END;
$$;

CREATE TRIGGER prevent_concierge_operational_create_request_mutation
    BEFORE UPDATE OR DELETE ON concierge_operational_item_create_requests
    FOR EACH ROW EXECUTE FUNCTION prevent_concierge_operational_create_request_mutation();
