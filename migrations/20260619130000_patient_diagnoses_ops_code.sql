-- Diagnosis tree procedures need an OPS code on patient_diagnoses.
-- The previous diagnosis-tree migration widened kind to include 'prozedur',
-- and the API already reads/writes ops_code for those rows.

ALTER TABLE patient_diagnoses
    ADD COLUMN IF NOT EXISTS ops_code TEXT;
