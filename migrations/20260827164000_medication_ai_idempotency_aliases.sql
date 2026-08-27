-- Persist every Medication AI idempotency binding handled after this
-- migration, including a second key that semantically deduplicates to an
-- existing analysis. Historical primary keys can be backfilled; historical
-- semantic-dedup aliases were never stored and cannot be reconstructed. Keys
-- are bounded operational secrets and remain outside API and Art. 15 payloads.

-- Serialize analysis writers for the backfill/trigger hand-off. The migration
-- is transactional, so no primary key can commit between those two steps.
LOCK TABLE medication_ai_analyses IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE medication_ai_analysis_idempotency_keys (
    idempotency_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL
        CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 128),
    analysis_id UUID NOT NULL
        REFERENCES medication_ai_analyses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (idempotency_owner_id, idempotency_key)
);

CREATE INDEX idx_medication_ai_idempotency_keys_analysis
    ON medication_ai_analysis_idempotency_keys(analysis_id);

-- Existing primary keys belong to the actor that created the analysis.
INSERT INTO medication_ai_analysis_idempotency_keys
    (idempotency_owner_id, idempotency_key, analysis_id, created_at)
SELECT requested_by, idempotency_key, id, requested_at
FROM medication_ai_analyses;

-- Keep primary keys inserted by a previous binary visible to the new lookup
-- path. The trigger runs in the same transaction as the owning analysis.
CREATE OR REPLACE FUNCTION capture_medication_ai_analysis_idempotency_key()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO medication_ai_analysis_idempotency_keys
        (idempotency_owner_id, idempotency_key, analysis_id, created_at)
    VALUES (NEW.requested_by, NEW.idempotency_key, NEW.id, NEW.requested_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_ai_analysis_idempotency_key_capture
    AFTER INSERT ON medication_ai_analyses
    FOR EACH ROW EXECUTE FUNCTION capture_medication_ai_analysis_idempotency_key();

-- Bindings cannot be reassigned. The delete guard below distinguishes a
-- parent-driven privacy cascade from a standalone alias deletion.
CREATE TRIGGER medication_ai_analysis_idempotency_keys_immutable
    BEFORE UPDATE ON medication_ai_analysis_idempotency_keys
    FOR EACH ROW EXECUTE FUNCTION prevent_medication_evidence_update();

CREATE OR REPLACE FUNCTION guard_medication_ai_idempotency_key_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- A direct alias delete would make the same actor/key reusable. Cascades
    -- remain valid once either owning parent is already being erased.
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
