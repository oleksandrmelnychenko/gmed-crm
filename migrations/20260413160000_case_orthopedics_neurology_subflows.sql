CREATE TABLE case_orthopedics_assessments (
    case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    is_relevant BOOLEAN NOT NULL DEFAULT false,
    joint_pain BOOLEAN NOT NULL DEFAULT false,
    back_pain BOOLEAN NOT NULL DEFAULT false,
    mobility_limitation BOOLEAN NOT NULL DEFAULT false,
    trauma_history BOOLEAN NOT NULL DEFAULT false,
    prior_imaging TEXT,
    assistive_devices TEXT,
    physiotherapy_history TEXT,
    pain_triggers TEXT,
    red_flags TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_case_orthopedics_assessments
    BEFORE UPDATE ON case_orthopedics_assessments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE case_neurology_assessments (
    case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    is_relevant BOOLEAN NOT NULL DEFAULT false,
    headache BOOLEAN NOT NULL DEFAULT false,
    dizziness BOOLEAN NOT NULL DEFAULT false,
    sensory_changes BOOLEAN NOT NULL DEFAULT false,
    weakness BOOLEAN NOT NULL DEFAULT false,
    seizure_history BOOLEAN NOT NULL DEFAULT false,
    gait_balance_issues BOOLEAN NOT NULL DEFAULT false,
    prior_neuro_imaging TEXT,
    prior_neurology_workup TEXT,
    cognitive_changes TEXT,
    red_flags TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_case_neurology_assessments
    BEFORE UPDATE ON case_neurology_assessments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
