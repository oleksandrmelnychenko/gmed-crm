-- Persist every successful Medication AI idempotency binding, including a
-- second key that semantically deduplicates to an existing analysis. Keys are
-- bounded operational secrets: they remain outside API and Art. 15 payloads.

CREATE TABLE medication_ai_analysis_idempotency_keys (
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL
        CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 128),
    analysis_id UUID NOT NULL
        REFERENCES medication_ai_analyses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (requested_by, idempotency_key)
);

CREATE INDEX idx_medication_ai_idempotency_keys_analysis
    ON medication_ai_analysis_idempotency_keys(analysis_id);

CREATE OR REPLACE FUNCTION capture_medication_ai_analysis_idempotency_key()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO medication_ai_analysis_idempotency_keys
        (requested_by, idempotency_key, analysis_id, created_at)
    VALUES (NEW.requested_by, NEW.idempotency_key, NEW.id, NEW.requested_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_ai_analysis_idempotency_key_capture
    AFTER INSERT ON medication_ai_analyses
    FOR EACH ROW EXECUTE FUNCTION capture_medication_ai_analysis_idempotency_key();

INSERT INTO medication_ai_analysis_idempotency_keys
    (requested_by, idempotency_key, analysis_id, created_at)
SELECT requested_by, idempotency_key, id, requested_at
FROM medication_ai_analyses
ON CONFLICT (requested_by, idempotency_key) DO NOTHING;

CREATE TRIGGER medication_ai_analysis_idempotency_keys_immutable
    BEFORE UPDATE ON medication_ai_analysis_idempotency_keys
    FOR EACH ROW EXECUTE FUNCTION prevent_medication_evidence_update();

COMMENT ON TABLE medication_ai_analysis_idempotency_keys IS
    'Append-only operational-secret aliases for durable Medication AI idempotency; privacy erasure cascades through analysis_id.';
