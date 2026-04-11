CREATE TABLE patient_privacy_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id),
    request_type TEXT NOT NULL CHECK (
        request_type IN ('erasure', 'restriction', 'third_party_revoke')
    ),
    source TEXT NOT NULL DEFAULT 'patient_request' CHECK (
        source IN ('patient_request', 'admin_intake')
    ),
    status TEXT NOT NULL DEFAULT 'requested' CHECK (
        status IN ('requested', 'approved', 'rejected', 'executed')
    ),
    reason TEXT,
    review_note TEXT,
    due_at TIMESTAMPTZ,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    executed_by UUID REFERENCES users(id),
    executed_at TIMESTAMPTZ,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_privacy_requests_patient
    ON patient_privacy_requests(patient_id, requested_at DESC);

CREATE INDEX idx_patient_privacy_requests_status
    ON patient_privacy_requests(status, requested_at DESC);

CREATE INDEX idx_patient_privacy_requests_requested_by
    ON patient_privacy_requests(requested_by, requested_at DESC);

CREATE TRIGGER set_updated_at_patient_privacy_requests
    BEFORE UPDATE ON patient_privacy_requests
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
