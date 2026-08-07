-- Patient-scoped medical document parsing jobs. The parser is deliberately
-- draft-only: a human must review the candidates before existing clinical APIs
-- may persist anything into the patient's longitudinal record.

CREATE TABLE clinical_document_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'review_required', 'applied', 'failed')),
    document_type TEXT,
    source_language TEXT,
    parser_version TEXT,
    draft JSONB NOT NULL DEFAULT '{"candidates":[],"warnings":[]}'::jsonb,
    reviewed_draft JSONB,
    applied_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    requested_by UUID NOT NULL REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    applied_by UUID REFERENCES users(id),
    worker_id TEXT,
    locked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clinical_document_imports_patient_created
    ON clinical_document_imports (patient_id, created_at DESC);

CREATE INDEX idx_clinical_document_imports_queue
    ON clinical_document_imports (created_at)
    WHERE status = 'queued';

CREATE UNIQUE INDEX uq_clinical_document_imports_document_open
    ON clinical_document_imports (document_id)
    WHERE status IN ('queued', 'processing', 'review_required');

-- Provenance is retained on every imported clinical fact. Existing manual
-- save paths leave these columns NULL.
ALTER TABLE patient_diagnoses
    ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_candidate_id TEXT;

ALTER TABLE patient_medications
    ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_candidate_id TEXT;

ALTER TABLE patient_examinations
    ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_candidate_id TEXT;

ALTER TABLE patient_clinical_narrative
    ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL;

ALTER TABLE patient_recommendations
    ADD COLUMN IF NOT EXISTS source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_candidate_id TEXT;

CREATE UNIQUE INDEX uq_patient_diagnoses_import_candidate
    ON patient_diagnoses (source_import_id, source_candidate_id)
    WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL;

CREATE UNIQUE INDEX uq_patient_medications_import_candidate
    ON patient_medications (source_import_id, source_candidate_id)
    WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL;

CREATE UNIQUE INDEX uq_patient_examinations_import_candidate
    ON patient_examinations (source_import_id, source_candidate_id)
    WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL;

CREATE UNIQUE INDEX uq_patient_narrative_source_import
    ON patient_clinical_narrative (source_import_id)
    WHERE source_import_id IS NOT NULL;

CREATE UNIQUE INDEX uq_patient_recommendations_import_candidate
    ON patient_recommendations (source_import_id, source_candidate_id)
    WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL;
