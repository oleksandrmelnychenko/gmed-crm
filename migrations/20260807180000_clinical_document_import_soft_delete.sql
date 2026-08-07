-- Keep medical import provenance intact while allowing users to remove a
-- processing snapshot from the patient-scoped history.

ALTER TABLE clinical_document_imports
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DROP INDEX IF EXISTS uq_clinical_document_imports_document_open;

CREATE UNIQUE INDEX uq_clinical_document_imports_document_open
    ON clinical_document_imports (document_id)
    WHERE status IN ('queued', 'processing', 'review_required')
      AND deleted_at IS NULL;

DROP INDEX IF EXISTS idx_clinical_document_imports_queue;

CREATE INDEX idx_clinical_document_imports_queue
    ON clinical_document_imports (created_at)
    WHERE status = 'queued' AND deleted_at IS NULL;

CREATE INDEX idx_clinical_document_imports_patient_active_created
    ON clinical_document_imports (patient_id, created_at DESC)
    WHERE deleted_at IS NULL;
