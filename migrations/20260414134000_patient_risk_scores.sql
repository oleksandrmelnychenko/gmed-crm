CREATE TABLE patient_risk_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    computed_at TIMESTAMPTZ NOT NULL,
    score_type TEXT NOT NULL CHECK (
        score_type IN (
            'cha2ds2_vasc',
            'has_bled',
            'framingham',
            'fall_risk',
            'frailty',
            'nutrition_risk',
            'other'
        )
    ),
    score_value DOUBLE PRECISION NOT NULL CHECK (score_value >= 0),
    scale_max DOUBLE PRECISION CHECK (
        scale_max IS NULL OR (scale_max > 0 AND score_value <= scale_max)
    ),
    interpretation TEXT,
    source TEXT,
    inputs JSONB,
    recorded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_risk_scores_patient_computed
    ON patient_risk_scores(patient_id, computed_at DESC, created_at DESC);
