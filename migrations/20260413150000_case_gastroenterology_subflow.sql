CREATE TABLE case_gastroenterology_assessments (
    case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    is_relevant BOOLEAN NOT NULL DEFAULT false,
    abdominal_pain BOOLEAN NOT NULL DEFAULT false,
    reflux BOOLEAN NOT NULL DEFAULT false,
    nausea BOOLEAN NOT NULL DEFAULT false,
    diarrhea BOOLEAN NOT NULL DEFAULT false,
    constipation BOOLEAN NOT NULL DEFAULT false,
    gi_bleeding BOOLEAN NOT NULL DEFAULT false,
    prior_endoscopy TEXT,
    bowel_habits TEXT,
    liver_history TEXT,
    food_intolerance TEXT,
    red_flags TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_case_gastroenterology_assessments
    BEFORE UPDATE ON case_gastroenterology_assessments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
