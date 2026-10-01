-- A specialization can carry the questions its anamnesis starts from. When the
-- specialization is added to an anamnesis, this text is placed into its
-- "Fachspezifische Anamnese" field; staff maintain it in the directory.
ALTER TABLE medical_specializations
    ADD COLUMN IF NOT EXISTS anamnesis_template TEXT;

ALTER TABLE medical_specializations
    DROP CONSTRAINT IF EXISTS medical_specializations_anamnesis_template_bounds;

ALTER TABLE medical_specializations
    ADD CONSTRAINT medical_specializations_anamnesis_template_bounds
        CHECK (
            anamnesis_template IS NULL
            OR (btrim(anamnesis_template) <> '' AND char_length(anamnesis_template) <= 4000)
        );

-- First template (owner decision 2026-10-01): oncology asks for B symptoms.
UPDATE medical_specializations
SET anamnesis_template = E'B-Symptomatik:\n- Fieber:\n- Gewichtsverlust:\n- Nachtschweiß:',
    updated_at = now()
WHERE code = 'oncology'
  AND anamnesis_template IS NULL;
