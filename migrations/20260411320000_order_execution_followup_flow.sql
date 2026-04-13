CREATE TABLE order_execution_flows (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    arrival_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (arrival_status IN ('pending', 'arrived', 'not_required')),
    medical_execution_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (medical_execution_status IN ('pending', 'in_progress', 'completed', 'not_required')),
    non_medical_execution_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (non_medical_execution_status IN ('pending', 'in_progress', 'completed', 'not_required')),
    interpreter_service_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (interpreter_service_status IN ('pending', 'in_progress', 'completed', 'not_required')),
    issue_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (issue_status IN ('pending', 'monitoring', 'resolved', 'not_required')),
    deviation_note TEXT,
    execution_summary TEXT,
    arrival_recorded_at TIMESTAMPTZ,
    arrival_recorded_by UUID REFERENCES users(id),
    medical_completed_at TIMESTAMPTZ,
    medical_completed_by UUID REFERENCES users(id),
    non_medical_completed_at TIMESTAMPTZ,
    non_medical_completed_by UUID REFERENCES users(id),
    interpreter_completed_at TIMESTAMPTZ,
    interpreter_completed_by UUID REFERENCES users(id),
    issues_resolved_at TIMESTAMPTZ,
    issues_resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_order_execution_flows
    BEFORE UPDATE ON order_execution_flows
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE order_followup_flows (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    doctor_followup_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (doctor_followup_status IN ('pending', 'scheduled', 'completed', 'not_required')),
    followup_1w_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (followup_1w_status IN ('pending', 'scheduled', 'completed', 'not_required')),
    followup_1m_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (followup_1m_status IN ('pending', 'scheduled', 'completed', 'not_required')),
    followup_6m_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (followup_6m_status IN ('pending', 'scheduled', 'completed', 'not_required')),
    package_end_date DATE,
    package_end_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (package_end_status IN ('pending', 'scheduled', 'completed', 'not_required')),
    results_handoff_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (results_handoff_status IN ('pending', 'completed', 'not_required')),
    followup_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_order_followup_flows
    BEFORE UPDATE ON order_followup_flows
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
