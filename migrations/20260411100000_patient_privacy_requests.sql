CREATE TABLE IF NOT EXISTS patient_privacy_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id),
    request_type TEXT NOT NULL CHECK (request_type IN ('erasure', 'restriction')),
    source TEXT NOT NULL DEFAULT 'patient_request' CHECK (source IN ('patient_request', 'admin_intake', 'legal_hold')),
    status TEXT NOT NULL CHECK (status IN ('requested', 'retention_hold', 'approved', 'rejected', 'completed')),
    reason TEXT,
    due_at TIMESTAMPTZ,
    retention_until TIMESTAMPTZ,
    review_note TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    executed_by UUID REFERENCES users(id),
    executed_at TIMESTAMPTZ,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_privacy_requests_patient
    ON patient_privacy_requests(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_privacy_requests_status
    ON patient_privacy_requests(status, due_at);

CREATE TRIGGER set_updated_at_patient_privacy_requests
    BEFORE UPDATE ON patient_privacy_requests
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO system_settings (key, value, description)
VALUES
    ('patient_erasure_due_days', '30', 'Target time in days for DSGVO erasure or restriction request processing'),
    ('patient_retention_hold_days', '3650', 'Default retention hold in days for patient privacy requests')
ON CONFLICT (key) DO NOTHING;
