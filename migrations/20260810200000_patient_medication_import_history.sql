-- Lossless, append-aware medication imports from reviewed OCR documents.
-- A medication may have several regimen rows over time.  The current row has
-- superseded_at IS NULL; older rows remain available for audit/history.

ALTER TABLE patient_medications
    ADD COLUMN IF NOT EXISTS medication_series_id UUID,
    ADD COLUMN IF NOT EXISTS supersedes_medication_id UUID
        REFERENCES patient_medications(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS regimen_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS source_country TEXT,
    ADD COLUMN IF NOT EXISTS source_date DATE,
    ADD COLUMN IF NOT EXISTS source_page INTEGER,
    ADD COLUMN IF NOT EXISTS source_raw_text TEXT,
    ADD COLUMN IF NOT EXISTS source_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS source_field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Applying is an explicit, immutable review-selection stage.  Live clinical
-- writes are only accepted after a reviewed payload has entered this state.
ALTER TABLE clinical_document_imports
    DROP CONSTRAINT IF EXISTS clinical_document_imports_status_check,
    ADD CONSTRAINT clinical_document_imports_status_check CHECK (
        status IN ('queued', 'processing', 'review_required', 'applying', 'applied', 'failed')
    ),
    ADD COLUMN IF NOT EXISTS prepared_payload_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS prepared_source_country TEXT,
    ADD COLUMN IF NOT EXISTS prepared_candidate_payloads JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ;

ALTER TABLE clinical_document_imports
    ADD CONSTRAINT clinical_document_imports_prepared_country_check CHECK (
        prepared_source_country IS NULL
        OR prepared_source_country ~ '^[A-Z]{2}$'
    ),
    ADD CONSTRAINT clinical_document_imports_prepared_candidate_payloads_check CHECK (
        jsonb_typeof(prepared_candidate_payloads) = 'object'
        AND octet_length(prepared_candidate_payloads::text) <= 1048576
    );

DROP INDEX IF EXISTS uq_clinical_document_imports_document_open;
CREATE UNIQUE INDEX uq_clinical_document_imports_document_open
    ON clinical_document_imports (document_id)
    WHERE status IN ('queued', 'processing', 'review_required', 'applying')
      AND deleted_at IS NULL;

UPDATE patient_medications
SET medication_series_id = id
WHERE medication_series_id IS NULL;

ALTER TABLE patient_medications
    ALTER COLUMN medication_series_id SET NOT NULL,
    ALTER COLUMN medication_series_id SET DEFAULT gen_random_uuid(),
    ADD CONSTRAINT patient_medications_source_country_check
        CHECK (source_country IS NULL OR source_country ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT patient_medications_source_page_check
        CHECK (source_page IS NULL OR source_page > 0),
    ADD CONSTRAINT patient_medications_source_identifiers_object_check
        CHECK (jsonb_typeof(source_identifiers) = 'object'),
    ADD CONSTRAINT patient_medications_source_field_confidence_object_check
        CHECK (jsonb_typeof(source_field_confidence) = 'object');

CREATE INDEX IF NOT EXISTS idx_patient_medications_current
    ON patient_medications(patient_id, medication_series_id, created_at DESC)
    WHERE superseded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_medications_current_series
    ON patient_medications(patient_id, medication_series_id)
    WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_medications_regimen_fingerprint
    ON patient_medications(patient_id, regimen_fingerprint)
    WHERE superseded_at IS NULL AND regimen_fingerprint IS NOT NULL;

-- One immutable event/evidence row per import candidate.  Evidence is kept in
-- its own table because several documents may confirm the same current regimen
-- and must not overwrite the medication's first-source provenance.
CREATE TABLE patient_medication_import_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    -- Historical ids intentionally have no FK: deleting/replacing a current
    -- medication must not rewrite or erase the immutable evidence event.
    patient_medication_id UUID,
    prior_medication_id UUID,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'deduplicated', 'regimen_changed', 'status_transition',
        'historical_observation'
    )),
    medication_series_id UUID NOT NULL,
    regimen_fingerprint TEXT NOT NULL,
    review_fingerprint TEXT NOT NULL,
    source_document_id UUID,
    source_import_id UUID NOT NULL REFERENCES clinical_document_imports(id) ON DELETE CASCADE,
    source_candidate_id TEXT NOT NULL,
    source_country TEXT CHECK (source_country IS NULL OR source_country ~ '^[A-Z]{2}$'),
    source_date DATE,
    source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
    source_raw_text TEXT,
    source_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(source_identifiers) = 'object'),
    source_field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(source_field_confidence) = 'object'),
    old_value JSONB,
    new_value JSONB NOT NULL,
    reviewed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT patient_medication_import_history_candidate_not_blank
        CHECK (btrim(source_candidate_id) <> ''),
    CONSTRAINT patient_medication_import_history_candidate_unique
        UNIQUE (source_import_id, source_candidate_id)
);

CREATE INDEX idx_patient_medication_import_history_patient_created
    ON patient_medication_import_history(patient_id, source_date DESC, created_at DESC);

CREATE INDEX idx_patient_medication_import_history_medication
    ON patient_medication_import_history(patient_medication_id, created_at DESC)
    WHERE patient_medication_id IS NOT NULL;

CREATE INDEX idx_patient_medication_import_history_series
    ON patient_medication_import_history(patient_id, medication_series_id, source_date DESC, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_patient_medication_import_history_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'patient_medication_import_history is immutable; append a new event instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patient_medication_import_history_immutable
    BEFORE UPDATE ON patient_medication_import_history
    FOR EACH ROW
    EXECUTE FUNCTION prevent_patient_medication_import_history_update();

COMMENT ON TABLE patient_medication_import_history IS
    'Append-only reviewed OCR medication evidence and regimen/status transition history.';
