ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS clinical_warnings TEXT;

CREATE TABLE IF NOT EXISTS patient_vital_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    measured_at TIMESTAMPTZ NOT NULL,
    bp_systolic DOUBLE PRECISION,
    bp_diastolic DOUBLE PRECISION,
    heart_rate INT,
    weight_kg DOUBLE PRECISION,
    height_cm DOUBLE PRECISION,
    bmi DOUBLE PRECISION,
    notes TEXT,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT patient_vital_measurements_has_payload CHECK (
        bp_systolic IS NOT NULL
        OR bp_diastolic IS NOT NULL
        OR heart_rate IS NOT NULL
        OR weight_kg IS NOT NULL
        OR height_cm IS NOT NULL
        OR bmi IS NOT NULL
    ),
    CONSTRAINT patient_vital_measurements_bp_positive CHECK (
        bp_systolic IS NULL OR bp_systolic > 0
    ),
    CONSTRAINT patient_vital_measurements_bp_diastolic_positive CHECK (
        bp_diastolic IS NULL OR bp_diastolic > 0
    ),
    CONSTRAINT patient_vital_measurements_heart_rate_positive CHECK (
        heart_rate IS NULL OR heart_rate > 0
    ),
    CONSTRAINT patient_vital_measurements_weight_positive CHECK (
        weight_kg IS NULL OR weight_kg > 0
    ),
    CONSTRAINT patient_vital_measurements_height_positive CHECK (
        height_cm IS NULL OR height_cm > 0
    ),
    CONSTRAINT patient_vital_measurements_bmi_positive CHECK (
        bmi IS NULL OR bmi > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_patient_vitals_patient_measured
    ON patient_vital_measurements(patient_id, measured_at DESC, created_at DESC);
