CREATE TABLE IF NOT EXISTS patient_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    recommendation_type TEXT NOT NULL DEFAULT 'follow_up'
        CHECK (recommendation_type IN ('follow_up', 'consultation', 'lab_test', 'imaging', 'document', 'medication_review', 'other')),
    source_doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    source_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'declined', 'cancelled', 'superseded')),
    portal_visible BOOLEAN NOT NULL DEFAULT true,
    patient_decision TEXT
        CHECK (patient_decision IS NULL OR patient_decision IN ('schedule', 'already_done', 'need_consultation', 'declined')),
    decision_note TEXT,
    decided_at TIMESTAMPTZ,
    appointment_request_id UUID REFERENCES patient_appointment_requests(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_recommendation_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recommendation_id UUID NOT NULL REFERENCES patient_recommendations(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    decided_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision TEXT NOT NULL
        CHECK (decision IN ('schedule', 'already_done', 'need_consultation', 'declined')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_recommendation_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recommendation_id UUID NOT NULL REFERENCES patient_recommendations(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    notification_kind TEXT NOT NULL DEFAULT 'portal_reminder'
        CHECK (notification_kind IN ('portal_reminder', 'email_reminder', 'staff_followup')),
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'sent', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_patient_recommendations ON patient_recommendations;
CREATE TRIGGER set_updated_at_patient_recommendations
    BEFORE UPDATE ON patient_recommendations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_patient_recommendations_patient
    ON patient_recommendations(patient_id, status, due_at NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_recommendations_portal
    ON patient_recommendations(patient_id, portal_visible, status, due_at NULLS LAST)
    WHERE portal_visible = true;

CREATE INDEX IF NOT EXISTS idx_patient_recommendation_decisions_recommendation
    ON patient_recommendation_decisions(recommendation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_recommendation_notifications_due
    ON patient_recommendation_notifications(status, scheduled_for)
    WHERE status = 'scheduled';
