-- Corrections preserve the immutable source provenance while making the
-- latest reviewed measurement and its human rationale visible to clinicians.

ALTER TABLE patient_lab_results
    ADD COLUMN corrected_at TIMESTAMPTZ,
    ADD COLUMN corrected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN correction_note TEXT;

ALTER TABLE patient_lab_results
    ADD CONSTRAINT patient_lab_results_correction_metadata_check CHECK (
        (
            corrected_at IS NULL
            AND corrected_by IS NULL
            AND correction_note IS NULL
        )
        OR (
            corrected_at IS NOT NULL
            AND correction_note IS NOT NULL
            AND btrim(correction_note) <> ''
            AND char_length(correction_note) <= 500
        )
    );

CREATE INDEX idx_patient_lab_results_corrected_by
    ON patient_lab_results (corrected_by)
    WHERE corrected_by IS NOT NULL;
