-- Provider-neutral, local-only Medication Evidence Review.
--
-- This workflow snapshots existing deterministic Medication Intelligence
-- evidence. It does not execute a model, approve clinical decisions, or make
-- treatment/dosage recommendations. Patient privacy erasure may cascade-delete
-- these records; during the retention period evidence and drafts are immutable.

CREATE TABLE medication_evidence_bundles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    bundle_version TEXT NOT NULL DEFAULT 'medication-evidence-v1'
        CHECK (bundle_version = 'medication-evidence-v1'),
    intelligence_fingerprint TEXT NOT NULL
        CHECK (intelligence_fingerprint ~ '^[0-9a-f]{64}$'),
    evidence_snapshot JSONB NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_evidence_snapshot_shape CHECK (
        jsonb_typeof(evidence_snapshot) = 'object'
        AND jsonb_typeof(evidence_snapshot->'summary') = 'object'
        AND jsonb_typeof(evidence_snapshot->'medication_ids') = 'array'
        AND jsonb_typeof(evidence_snapshot->'findings') = 'array'
        AND jsonb_typeof(evidence_snapshot->'missing_data') = 'array'
        AND jsonb_typeof(evidence_snapshot->'sources') = 'array'
        AND jsonb_typeof(evidence_snapshot->'citations') = 'array'
        AND octet_length(evidence_snapshot::text) <= 1048576
    ),
    UNIQUE (patient_id, bundle_version, intelligence_fingerprint),
    UNIQUE (id, patient_id)
);

CREATE INDEX idx_medication_evidence_bundles_patient_created
    ON medication_evidence_bundles(patient_id, created_at DESC, id DESC);

CREATE TABLE medication_evidence_review_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    bundle_id UUID NOT NULL REFERENCES medication_evidence_bundles(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'draft_ready', 'failed', 'superseded')),
    requested_fingerprint TEXT NOT NULL
        CHECK (requested_fingerprint ~ '^[0-9a-f]{64}$'),
    idempotency_key TEXT NOT NULL
        CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 128),
    provider_kind TEXT NOT NULL DEFAULT 'none' CHECK (provider_kind = 'none'),
    provider_status TEXT NOT NULL DEFAULT 'not_configured'
        CHECK (provider_status IN ('not_configured', 'disabled')),
    external_calls_enabled BOOLEAN NOT NULL DEFAULT false
        CHECK (external_calls_enabled = false),
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_evidence_request_completion CHECK (
        (status = 'requested' AND completed_at IS NULL)
        OR (status IN ('draft_ready', 'failed', 'superseded') AND completed_at IS NOT NULL)
    ),
    CONSTRAINT medication_evidence_request_bundle_patient_fk
        FOREIGN KEY (bundle_id, patient_id)
        REFERENCES medication_evidence_bundles(id, patient_id)
        ON DELETE RESTRICT,
    UNIQUE (requested_by, idempotency_key),
    UNIQUE (id, patient_id, bundle_id),
    UNIQUE (id, bundle_id)
);

CREATE INDEX idx_medication_evidence_review_requests_patient
    ON medication_evidence_review_requests(patient_id, requested_at DESC, id DESC);

CREATE TABLE medication_evidence_review_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE
        REFERENCES medication_evidence_review_requests(id) ON DELETE CASCADE,
    bundle_id UUID NOT NULL REFERENCES medication_evidence_bundles(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status = 'ready'),
    evidence_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
    verification_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
    citation_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_evidence_draft_request_bundle_fk
        FOREIGN KEY (request_id, bundle_id)
        REFERENCES medication_evidence_review_requests(id, bundle_id)
        ON DELETE CASCADE,
    CONSTRAINT medication_evidence_draft_arrays CHECK (
        jsonb_typeof(evidence_summary) = 'array'
        AND jsonb_typeof(verification_questions) = 'array'
        AND jsonb_typeof(limitations) = 'array'
        AND jsonb_typeof(citation_refs) = 'array'
        AND octet_length(evidence_summary::text) <= 262144
        AND octet_length(verification_questions::text) <= 131072
        AND octet_length(limitations::text) <= 65536
        AND octet_length(citation_refs::text) <= 65536
    )
);

CREATE TABLE medication_evidence_review_state_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL
        REFERENCES medication_evidence_review_requests(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL
        CHECK (to_status IN ('requested', 'draft_ready', 'failed', 'superseded')),
    reason_code TEXT CHECK (reason_code IS NULL OR reason_code ~ '^[a-z0-9_]{1,64}$'),
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_evidence_state_event_transition CHECK (
        (from_status IS NULL AND to_status = 'requested')
        OR (from_status = 'requested' AND to_status IN ('draft_ready', 'failed'))
        OR (from_status = 'draft_ready' AND to_status = 'superseded')
    )
);

CREATE INDEX idx_medication_evidence_state_events_request
    ON medication_evidence_review_state_events(request_id, created_at, id);

CREATE OR REPLACE FUNCTION medication_evidence_request_transition_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
       OR NEW.requested_fingerprint IS DISTINCT FROM OLD.requested_fingerprint
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.provider_kind IS DISTINCT FROM OLD.provider_kind
       OR NEW.provider_status IS DISTINCT FROM OLD.provider_status
       OR NEW.external_calls_enabled IS DISTINCT FROM OLD.external_calls_enabled
       OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
        RAISE EXCEPTION 'medication evidence request identity is immutable';
    END IF;

    IF NOT (
        (OLD.status = 'requested' AND NEW.status IN ('draft_ready', 'failed'))
        OR (OLD.status = 'draft_ready' AND NEW.status = 'superseded')
    ) THEN
        RAISE EXCEPTION 'invalid medication evidence request state transition: % -> %',
            OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_evidence_request_transition_guard
    BEFORE UPDATE ON medication_evidence_review_requests
    FOR EACH ROW
    EXECUTE FUNCTION medication_evidence_request_transition_guard();

CREATE OR REPLACE FUNCTION prevent_medication_evidence_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'medication evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_evidence_bundles_immutable
    BEFORE UPDATE ON medication_evidence_bundles
    FOR EACH ROW EXECUTE FUNCTION prevent_medication_evidence_update();

CREATE TRIGGER medication_evidence_drafts_immutable
    BEFORE UPDATE ON medication_evidence_review_drafts
    FOR EACH ROW EXECUTE FUNCTION prevent_medication_evidence_update();

CREATE TRIGGER medication_evidence_state_events_immutable
    BEFORE UPDATE ON medication_evidence_review_state_events
    FOR EACH ROW EXECUTE FUNCTION prevent_medication_evidence_update();

COMMENT ON TABLE medication_evidence_bundles IS
    'Immutable privacy-minimized Medication Intelligence evidence; no demographic identifiers.';
COMMENT ON TABLE medication_evidence_review_drafts IS
    'Deterministic local evidence drafts only; no model output or clinical approval.';
