-- Verlauf is a first-class clinical record and follows the same provenance
-- contract as diagnoses, anamnesis, medications and examinations. Manual
-- entries keep these columns NULL; imported entries retain their document.

ALTER TABLE patient_clinical_verlauf
    ADD COLUMN source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ADD COLUMN source_import_id UUID REFERENCES clinical_document_imports(id) ON DELETE SET NULL,
    ADD COLUMN source_candidate_id TEXT,
    ADD COLUMN source_page INTEGER;

ALTER TABLE patient_clinical_verlauf
    ADD CONSTRAINT patient_clinical_verlauf_source_page_check CHECK (
        source_page IS NULL OR source_page > 0
    );

CREATE UNIQUE INDEX uq_patient_clinical_verlauf_import_candidate
    ON patient_clinical_verlauf (source_import_id, source_candidate_id)
    WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL;

CREATE INDEX idx_patient_clinical_verlauf_source_document
    ON patient_clinical_verlauf (source_document_id)
    WHERE source_document_id IS NOT NULL;
