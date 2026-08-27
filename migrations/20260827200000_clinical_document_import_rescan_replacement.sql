-- A rescan is a new extraction attempt, not a replay of cached document text.
-- Applied imports are immutable audit records; their rescans form a linear,
-- auditable replacement chain instead of resetting the applied row in place.

ALTER TABLE clinical_document_imports
    ADD COLUMN force_reextract BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN replaces_import_id UUID
        REFERENCES clinical_document_imports(id) ON DELETE RESTRICT;

ALTER TABLE clinical_document_imports
    ADD CONSTRAINT clinical_document_imports_replacement_not_self_check CHECK (
        replaces_import_id IS NULL OR replaces_import_id <> id
    );

-- Do not allow two live branches to replace the same reviewed import. A failed
-- replacement can be retried in place; a deleted attempt permits a new one.
CREATE UNIQUE INDEX uq_clinical_document_imports_live_replacement
    ON clinical_document_imports (replaces_import_id)
    WHERE replaces_import_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_clinical_document_imports_replacement_chain
    ON clinical_document_imports (replaces_import_id, created_at DESC)
    WHERE replaces_import_id IS NOT NULL;

COMMENT ON COLUMN clinical_document_imports.force_reextract IS
    'When true, the parser must ignore documents.extracted_text and extract from the source file.';

COMMENT ON COLUMN clinical_document_imports.replaces_import_id IS
    'Applied import superseded by this auditable rescan attempt after successful completion.';
