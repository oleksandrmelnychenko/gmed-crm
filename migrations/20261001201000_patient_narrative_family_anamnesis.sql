-- Family anamnesis (Familienanamnese) as its own block of an anamnesis
-- version, next to the current, previous, vegetative and social anamnesis.
ALTER TABLE patient_clinical_narrative
    ADD COLUMN IF NOT EXISTS anamnese_familie TEXT;
