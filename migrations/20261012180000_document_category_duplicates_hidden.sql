-- QA 2026-10-12 B-12: three categories of the first document taxonomy
-- (2026-05) duplicate categories of the category tree (2026-06) under MED:
--   medical_report "Medizinischer Bericht"         ~ medical_bericht "Bericht"
--   conclusion     "Ärztlicher Abschluss / Befund" ~ medical_befund  "Befund"
--   lab_analysis   "Labor / Analyse"               ~ medical_lab     "Labor"
-- The staff picker offered both, an ambiguous choice. The old codes stay valid
-- — documents keep them, the patient portal and the clinical import still
-- file uploads under them, and a document already filed there still shows its
-- category — but the picker no longer offers them for a new choice.

ALTER TABLE ref_document_categories
    ADD COLUMN IF NOT EXISTS selectable BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN ref_document_categories.selectable IS
    'Offered in the staff category picker. false: a legacy duplicate that documents may keep but that is no longer chosen.';

UPDATE ref_document_categories
SET selectable = false
WHERE id IN ('medical_report', 'conclusion', 'lab_analysis');

-- The kept categories name the legacy codes, so a search by the old code
-- finds the category that replaces it in the picker.
UPDATE ref_document_categories AS kept
SET aliases = ARRAY(
        SELECT DISTINCT alias
        FROM unnest(kept.aliases || legacy.codes) AS alias
        ORDER BY alias
    )
FROM (VALUES
        ('medical_bericht', ARRAY['medical_report']::TEXT[]),
        ('medical_befund', ARRAY['conclusion']::TEXT[]),
        ('medical_lab', ARRAY['lab_analysis']::TEXT[])
     ) AS legacy(id, codes)
WHERE kept.id = legacy.id;
