-- Preserve the immutable 20260827164000 migration while hardening its owner
-- semantics for privacy erasure and actor-scoped semantic deduplication.

LOCK TABLE medication_ai_analyses IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE medication_ai_analysis_idempotency_keys IN ACCESS EXCLUSIVE MODE;

ALTER TABLE medication_ai_analysis_idempotency_keys
    RENAME COLUMN requested_by TO idempotency_owner_id;

ALTER TABLE medication_ai_analysis_idempotency_keys
    DROP CONSTRAINT medication_ai_analysis_idempotency_keys_requested_by_fkey,
    ADD CONSTRAINT medication_ai_analysis_idempotency_keys_owner_fkey
        FOREIGN KEY (idempotency_owner_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION capture_medication_ai_analysis_idempotency_key()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO medication_ai_analysis_idempotency_keys
        (idempotency_owner_id, idempotency_key, analysis_id, created_at)
    VALUES (NEW.requested_by, NEW.idempotency_key, NEW.id, NEW.requested_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bindings cannot be reassigned. A delete is valid only as part of an owner
-- or analysis privacy cascade; a direct delete would make the key reusable.
CREATE OR REPLACE FUNCTION guard_medication_ai_idempotency_key_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM medication_ai_analyses WHERE id = OLD.analysis_id
    ) AND EXISTS (
        SELECT 1 FROM users WHERE id = OLD.idempotency_owner_id
    ) THEN
        RAISE EXCEPTION 'medication AI idempotency binding is write-once';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_ai_analysis_idempotency_keys_delete_guard
    BEFORE DELETE ON medication_ai_analysis_idempotency_keys
    FOR EACH ROW EXECUTE FUNCTION guard_medication_ai_idempotency_key_delete();

COMMENT ON TABLE medication_ai_analysis_idempotency_keys IS
    'Write-once operational-secret aliases for durable Medication AI idempotency; rows follow analysis or owner privacy erasure.';

COMMENT ON COLUMN medication_ai_analysis_idempotency_keys.idempotency_owner_id IS
    'Actor-specific key namespace; may differ from the analysis creator after authorized semantic deduplication.';

COMMENT ON COLUMN medication_ai_analysis_idempotency_keys.idempotency_key IS
    'Bounded operational secret; never include in API, logs, metrics, or Art. 15 export.';
