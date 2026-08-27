-- Preserve explanatory reference trees and laboratory comments next to the
-- measured observation without turning legend rows into synthetic analytes.

ALTER TABLE patient_lab_results
    ADD COLUMN interpretation_note TEXT;

ALTER TABLE patient_lab_results
    ADD CONSTRAINT patient_lab_results_interpretation_note_check CHECK (
        interpretation_note IS NULL
        OR (
            btrim(interpretation_note) <> ''
            AND char_length(interpretation_note) <= 4000
        )
    );
