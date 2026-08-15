-- Keep the clinical origin of a laboratory result separate from technical
-- provenance (uploaded document) and audit attribution (the CRM user who
-- recorded it).

ALTER TABLE patient_lab_results
    ADD COLUMN laboratory_name TEXT;

ALTER TABLE patient_lab_results
    ADD CONSTRAINT patient_lab_results_laboratory_name_check CHECK (
        laboratory_name IS NULL
        OR (btrim(laboratory_name) <> '' AND char_length(laboratory_name) <= 160)
    );
