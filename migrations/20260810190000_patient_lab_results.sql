-- Structured longitudinal laboratory observations imported from documents or
-- entered manually. Keep the original textual result/reference alongside
-- optional numeric projections so values such as "< 0,5" remain lossless.

CREATE TABLE patient_lab_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    measured_at TIMESTAMPTZ NOT NULL,
    panel TEXT,
    analyte_name TEXT NOT NULL,
    result_text TEXT NOT NULL,
    numeric_result DOUBLE PRECISION,
    comparator TEXT CHECK (comparator IN ('<', '<=', '=', '>=', '>')),
    unit TEXT,
    reference_text TEXT,
    reference_low DOUBLE PRECISION,
    reference_high DOUBLE PRECISION,
    abnormal_flag TEXT NOT NULL DEFAULT 'unknown'
        CHECK (abnormal_flag IN ('normal', 'low', 'high', 'abnormal', 'unknown')),
    source_country TEXT CHECK (source_country ~ '^[A-Z]{2}$'),
    source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL,
    source_candidate_id TEXT,
    source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT patient_lab_results_analyte_not_blank CHECK (btrim(analyte_name) <> ''),
    CONSTRAINT patient_lab_results_result_not_blank CHECK (btrim(result_text) <> ''),
    CONSTRAINT patient_lab_results_reference_order CHECK (
        reference_low IS NULL OR reference_high IS NULL OR reference_low <= reference_high
    )
);

CREATE INDEX idx_patient_lab_results_patient_measured
    ON patient_lab_results (patient_id, measured_at DESC, created_at DESC);

CREATE INDEX idx_patient_lab_results_patient_analyte
    ON patient_lab_results (patient_id, lower(analyte_name), measured_at DESC);

CREATE UNIQUE INDEX uq_patient_lab_results_import_candidate
    ON patient_lab_results (source_import_id, source_candidate_id)
    WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL;
