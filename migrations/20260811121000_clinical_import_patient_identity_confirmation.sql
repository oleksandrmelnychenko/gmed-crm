-- Freeze an explicit reviewer confirmation when the authoritative parser
-- subject has a name-only mismatch with the target patient.

ALTER TABLE clinical_document_imports
    ADD COLUMN IF NOT EXISTS prepared_patient_identity_confirmed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS prepared_identity_gate_version SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE clinical_document_imports
    ADD CONSTRAINT clinical_document_imports_identity_gate_version_check CHECK (
        prepared_identity_gate_version BETWEEN 0 AND 1
    );
