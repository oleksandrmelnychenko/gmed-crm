CREATE TABLE case_pulmonology_assessments (
    case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    is_relevant BOOLEAN NOT NULL DEFAULT false,
    chronic_cough BOOLEAN NOT NULL DEFAULT false,
    dyspnea BOOLEAN NOT NULL DEFAULT false,
    wheezing BOOLEAN NOT NULL DEFAULT false,
    chest_tightness BOOLEAN NOT NULL DEFAULT false,
    hemoptysis BOOLEAN NOT NULL DEFAULT false,
    smoking_history TEXT,
    prior_chest_imaging TEXT,
    inhaler_therapy TEXT,
    sleep_apnea_history TEXT,
    red_flags TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_case_pulmonology_assessments
    BEFORE UPDATE ON case_pulmonology_assessments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE case_urology_assessments (
    case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    is_relevant BOOLEAN NOT NULL DEFAULT false,
    dysuria BOOLEAN NOT NULL DEFAULT false,
    hematuria BOOLEAN NOT NULL DEFAULT false,
    flank_pain BOOLEAN NOT NULL DEFAULT false,
    urinary_frequency BOOLEAN NOT NULL DEFAULT false,
    urinary_retention BOOLEAN NOT NULL DEFAULT false,
    incontinence BOOLEAN NOT NULL DEFAULT false,
    prior_urology_workup TEXT,
    catheter_history TEXT,
    stone_history TEXT,
    red_flags TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_case_urology_assessments
    BEFORE UPDATE ON case_urology_assessments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
