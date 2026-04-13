CREATE TABLE case_cardiology_assessments (
    case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    is_relevant BOOLEAN NOT NULL DEFAULT false,
    chest_pain BOOLEAN NOT NULL DEFAULT false,
    dyspnea BOOLEAN NOT NULL DEFAULT false,
    palpitations BOOLEAN NOT NULL DEFAULT false,
    syncope BOOLEAN NOT NULL DEFAULT false,
    edema BOOLEAN NOT NULL DEFAULT false,
    known_diagnosis TEXT,
    prior_cardiac_workup TEXT,
    cardiovascular_risk_factors TEXT,
    anticoagulation TEXT,
    family_history TEXT,
    red_flags TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_case_cardiology_assessments
    BEFORE UPDATE ON case_cardiology_assessments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
