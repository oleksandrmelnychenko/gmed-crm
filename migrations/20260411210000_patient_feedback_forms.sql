CREATE TABLE patient_feedback_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    patient_manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    interpreter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    concierge_id UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_by UUID NOT NULL REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('patient_portal', 'staff_capture')),
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'archived')),
    overall_score INT NOT NULL CHECK (overall_score BETWEEN 1 AND 5),
    patient_manager_score INT CHECK (patient_manager_score BETWEEN 1 AND 5),
    interpreter_score INT CHECK (interpreter_score BETWEEN 1 AND 5),
    concierge_score INT CHECK (concierge_score BETWEEN 1 AND 5),
    treatment_score INT CHECK (treatment_score BETWEEN 1 AND 5),
    doctor_score INT CHECK (doctor_score BETWEEN 1 AND 5),
    nps_score INT NOT NULL CHECK (nps_score BETWEEN 0 AND 10),
    comments TEXT,
    improvement_notes TEXT,
    internal_note TEXT,
    review_note TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_patient ON patient_feedback_forms(patient_id, submitted_at DESC);
CREATE INDEX idx_feedback_provider ON patient_feedback_forms(provider_id, submitted_at DESC);
CREATE INDEX idx_feedback_interpreter ON patient_feedback_forms(interpreter_id, submitted_at DESC);
CREATE INDEX idx_feedback_status ON patient_feedback_forms(status, submitted_at DESC);

CREATE UNIQUE INDEX idx_feedback_unique_patient_portal_appointment
    ON patient_feedback_forms(patient_id, appointment_id, source)
    WHERE source = 'patient_portal' AND appointment_id IS NOT NULL;

CREATE TRIGGER set_updated_at_patient_feedback
    BEFORE UPDATE ON patient_feedback_forms
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
