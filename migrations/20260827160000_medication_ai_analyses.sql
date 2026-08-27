-- Privacy-minimised, review-scoped AI drafts for Medication Intelligence.
-- The immutable local evidence bundle remains the source of truth. AI output
-- is a separate, auditable draft and can never represent clinical approval.

CREATE TABLE medication_ai_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    review_id UUID NOT NULL,
    bundle_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'processing', 'ready', 'failed')),
    provider_kind TEXT NOT NULL CHECK (provider_kind = 'openai'),
    provider_model TEXT NOT NULL
        CHECK (provider_model ~ '^[A-Za-z0-9._-]{1,96}$'),
    input_schema_version TEXT NOT NULL DEFAULT 'medication-ai-input-v1'
        CHECK (input_schema_version = 'medication-ai-input-v1'),
    prompt_version TEXT NOT NULL DEFAULT 'medication-evidence-draft-v1'
        CHECK (prompt_version ~ '^[a-z0-9-]{1,64}$'),
    input_fingerprint TEXT NOT NULL
        CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
    idempotency_key TEXT NOT NULL
        CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 128),
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    lease_until TIMESTAMPTZ,
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    output_json JSONB,
    output_fingerprint TEXT
        CHECK (output_fingerprint IS NULL OR output_fingerprint ~ '^[0-9a-f]{64}$'),
    provider_response_id TEXT
        CHECK (provider_response_id IS NULL OR char_length(provider_response_id) BETWEEN 1 AND 128),
    provider_response_model TEXT
        CHECK (provider_response_model IS NULL OR provider_response_model ~ '^[A-Za-z0-9._-]{1,96}$'),
    error_code TEXT
        CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_ai_analysis_review_fk
        FOREIGN KEY (review_id, patient_id, bundle_id)
        REFERENCES medication_evidence_review_requests(id, patient_id, bundle_id)
        ON DELETE CASCADE,
    CONSTRAINT medication_ai_analysis_state_shape CHECK (
        (status = 'requested'
            AND started_at IS NULL AND completed_at IS NULL AND lease_until IS NULL
            AND output_json IS NULL AND output_fingerprint IS NULL
            AND provider_response_id IS NULL AND provider_response_model IS NULL
            AND error_code IS NULL)
        OR (status = 'processing'
            AND started_at IS NOT NULL AND completed_at IS NULL AND lease_until IS NOT NULL
            AND output_json IS NULL AND output_fingerprint IS NULL
            AND provider_response_id IS NULL AND provider_response_model IS NULL
            AND error_code IS NULL)
        OR (status = 'ready'
            AND started_at IS NOT NULL AND completed_at IS NOT NULL AND lease_until IS NULL
            AND output_json IS NOT NULL AND output_fingerprint IS NOT NULL
            AND provider_response_id IS NOT NULL AND provider_response_model IS NOT NULL
            AND error_code IS NULL)
        OR (status = 'failed'
            AND completed_at IS NOT NULL AND lease_until IS NULL
            AND output_json IS NULL AND output_fingerprint IS NULL
            AND provider_response_id IS NULL AND provider_response_model IS NULL
            AND error_code IS NOT NULL)
    ),
    CONSTRAINT medication_ai_analysis_output_shape CHECK (
        output_json IS NULL OR (
            jsonb_typeof(output_json) = 'object'
            AND jsonb_typeof(output_json->'evidence_summary') IS NOT DISTINCT FROM 'array'
            AND jsonb_array_length(output_json->'evidence_summary') <= 12
            AND jsonb_typeof(output_json->'verification_questions') IS NOT DISTINCT FROM 'array'
            AND jsonb_array_length(output_json->'verification_questions') <= 12
            AND jsonb_typeof(output_json->'limitations') IS NOT DISTINCT FROM 'array'
            AND jsonb_array_length(output_json->'limitations') BETWEEN 1 AND 8
            AND jsonb_typeof(output_json->'citation_refs') IS NOT DISTINCT FROM 'array'
            AND jsonb_array_length(output_json->'citation_refs') <= 256
            AND octet_length(output_json::text) <= 524288
        )
    ),
    UNIQUE (requested_by, idempotency_key),
    UNIQUE (review_id, input_fingerprint, provider_model, prompt_version)
);

CREATE INDEX idx_medication_ai_analyses_patient_requested
    ON medication_ai_analyses(patient_id, requested_at DESC, id DESC);
CREATE INDEX idx_medication_ai_analyses_worker
    ON medication_ai_analyses(status, available_at, requested_at)
    WHERE status IN ('requested', 'processing');

CREATE TABLE medication_ai_analysis_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID NOT NULL REFERENCES medication_ai_analyses(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL
        CHECK (to_status IN ('requested', 'processing', 'ready', 'failed')),
    reason_code TEXT NOT NULL CHECK (reason_code ~ '^[a-z0-9_]{1,64}$'),
    actor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_ai_analysis_event_transition CHECK (
        (from_status IS NULL AND to_status = 'requested')
        OR (from_status = 'requested' AND to_status = 'processing')
        OR (from_status = 'processing' AND to_status IN ('requested', 'ready', 'failed'))
        OR (from_status = 'failed' AND to_status = 'requested')
    )
);

CREATE INDEX idx_medication_ai_analysis_events_analysis
    ON medication_ai_analysis_events(analysis_id, created_at, id);

CREATE OR REPLACE FUNCTION medication_ai_analysis_transition_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.review_id IS DISTINCT FROM OLD.review_id
       OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
       OR NEW.provider_kind IS DISTINCT FROM OLD.provider_kind
       OR NEW.provider_model IS DISTINCT FROM OLD.provider_model
       OR NEW.input_schema_version IS DISTINCT FROM OLD.input_schema_version
       OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
       OR NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
        RAISE EXCEPTION 'medication AI analysis identity is immutable';
    END IF;
    IF NOT (
        (OLD.status = 'requested' AND NEW.status = 'processing')
        OR (OLD.status = 'processing' AND NEW.status IN ('requested', 'ready', 'failed'))
        OR (OLD.status = 'failed' AND NEW.status = 'requested')
    ) THEN
        RAISE EXCEPTION 'invalid medication AI analysis transition: % -> %',
            OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_ai_analysis_transition_guard
    BEFORE UPDATE ON medication_ai_analyses
    FOR EACH ROW EXECUTE FUNCTION medication_ai_analysis_transition_guard();

CREATE TRIGGER medication_ai_analysis_events_immutable
    BEFORE UPDATE ON medication_ai_analysis_events
    FOR EACH ROW EXECUTE FUNCTION prevent_medication_evidence_update();

COMMENT ON TABLE medication_ai_analyses IS
    'Privacy-minimised external AI drafts. No identity, raw document, free-form patient note, diagnosis, treatment, dose, or clinical approval.';
