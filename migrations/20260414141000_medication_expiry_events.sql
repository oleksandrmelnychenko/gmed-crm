CREATE TABLE medication_expiry_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medication_id UUID NOT NULL REFERENCES medikamente(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    expiry_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_confirmation'
        CHECK (status IN ('pending_confirmation', 'confirmed')),
    notification_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_expiry_events_confirmation_metadata_ck
        CHECK (
            status <> 'confirmed'
            OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
        )
);

CREATE UNIQUE INDEX idx_medication_expiry_pending
    ON medication_expiry_events(medication_id)
    WHERE status = 'pending_confirmation';

CREATE INDEX idx_medication_expiry_patient_status
    ON medication_expiry_events(patient_id, status, notification_sent_at DESC);

CREATE TRIGGER set_updated_at_medication_expiry_events
    BEFORE UPDATE ON medication_expiry_events
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
