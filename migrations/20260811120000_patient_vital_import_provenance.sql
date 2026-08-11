-- Extend longitudinal vital measurements with the observations parsed from
-- clinical documents and immutable provenance for staged OCR imports.

ALTER TABLE patient_vital_measurements
    ADD COLUMN IF NOT EXISTS temperature_c DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS oxygen_saturation DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS respiratory_rate INT,
    ADD COLUMN IF NOT EXISTS measured_at_precision TEXT NOT NULL DEFAULT 'datetime',
    ADD COLUMN IF NOT EXISTS source_country TEXT,
    ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_candidate_id TEXT,
    ADD COLUMN IF NOT EXISTS source_page INTEGER,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE patient_vital_measurements
    DROP CONSTRAINT IF EXISTS patient_vital_measurements_has_payload,
    ADD CONSTRAINT patient_vital_measurements_has_payload CHECK (
        bp_systolic IS NOT NULL
        OR bp_diastolic IS NOT NULL
        OR heart_rate IS NOT NULL
        OR temperature_c IS NOT NULL
        OR oxygen_saturation IS NOT NULL
        OR respiratory_rate IS NOT NULL
        OR weight_kg IS NOT NULL
        OR height_cm IS NOT NULL
        OR bmi IS NOT NULL
    ),
    ADD CONSTRAINT patient_vital_measurements_temperature_positive CHECK (
        temperature_c IS NULL OR temperature_c > 0
    ),
    ADD CONSTRAINT patient_vital_measurements_oxygen_saturation_range CHECK (
        oxygen_saturation IS NULL OR (oxygen_saturation >= 20 AND oxygen_saturation <= 100)
    ),
    ADD CONSTRAINT patient_vital_measurements_respiratory_rate_positive CHECK (
        respiratory_rate IS NULL OR respiratory_rate > 0
    ),
    ADD CONSTRAINT patient_vital_measurements_measured_at_precision_check CHECK (
        measured_at_precision IN ('date', 'datetime')
    ),
    ADD CONSTRAINT patient_vital_measurements_source_country_format CHECK (
        source_country IS NULL OR source_country ~ '^[A-Z]{2}$'
    ),
    ADD CONSTRAINT patient_vital_measurements_source_page_positive CHECK (
        source_page IS NULL OR source_page > 0
    ),
    ADD CONSTRAINT patient_vital_measurements_source_identity_pair CHECK (
        source_import_id IS NULL OR source_candidate_id IS NOT NULL
    ),
    ADD CONSTRAINT patient_vital_measurements_source_candidate_not_blank CHECK (
        source_candidate_id IS NULL OR btrim(source_candidate_id) <> ''
    );

CREATE UNIQUE INDEX uq_patient_vital_measurements_import_candidate
    ON patient_vital_measurements (source_import_id, source_candidate_id)
    WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL;
