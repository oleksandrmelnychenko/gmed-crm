-- Clinical lab rows use audited soft deletion so a mistaken value disappears
-- from the active history without erasing its source provenance or audit trail.

ALTER TABLE patient_lab_results
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_note TEXT;

ALTER TABLE patient_lab_results
    ADD CONSTRAINT patient_lab_results_deletion_metadata_check CHECK (
        (
            deleted_at IS NULL
            AND deleted_by IS NULL
            AND deletion_note IS NULL
        )
        OR (
            deleted_at IS NOT NULL
            AND deletion_note IS NOT NULL
            AND btrim(deletion_note) <> ''
            AND char_length(deletion_note) <= 500
        )
    );

CREATE INDEX idx_patient_lab_results_active_history
    ON patient_lab_results (patient_id, measured_at DESC, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_patient_lab_results_deleted_by
    ON patient_lab_results (deleted_by)
    WHERE deleted_by IS NOT NULL;
