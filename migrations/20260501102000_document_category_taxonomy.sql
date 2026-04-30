ALTER TABLE ref_document_categories
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS portal_group TEXT NOT NULL DEFAULT 'other',
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS patient_visible BOOLEAN NOT NULL DEFAULT true;

INSERT INTO ref_document_categories (
    id, name_de, name_en, is_medical, description, portal_group, sort_order, patient_visible
) VALUES
    ('clinic_correspondence', 'Klinikkorrespondenz', 'Clinic correspondence', false, 'Letters, confirmations and operational messages exchanged with clinics.', 'correspondence', 10, true),
    ('lab_analysis', 'Labor / Analyse', 'Lab / analysis', true, 'Laboratory findings, pathology, imaging analysis and diagnostic results.', 'lab_analysis', 20, true),
    ('medical_report', 'Medizinischer Bericht', 'Medical report', true, 'Doctor reports, discharge letters, treatment plans and clinical summaries.', 'medical_report', 30, true),
    ('translation', 'Übersetzung', 'Translation', false, 'Translated document versions and translation work products.', 'translation', 40, true),
    ('clinic_form', 'Klinikformular', 'Clinic form', false, 'Administrative forms received from or sent to clinics.', 'correspondence', 15, true)
ON CONFLICT (id) DO UPDATE SET
    name_de = EXCLUDED.name_de,
    name_en = EXCLUDED.name_en,
    is_medical = EXCLUDED.is_medical,
    description = EXCLUDED.description,
    portal_group = EXCLUDED.portal_group,
    sort_order = EXCLUDED.sort_order,
    patient_visible = EXCLUDED.patient_visible;

UPDATE ref_document_categories
SET portal_group = 'medical_report', sort_order = 35
WHERE id = 'medical';

UPDATE ref_document_categories
SET portal_group = 'administrative', sort_order = 60
WHERE id IN ('administrative', 'identity', 'consent', 'insurance', 'portal_upload', 'generated');

UPDATE ref_document_categories
SET portal_group = 'finance', sort_order = 70
WHERE id = 'finance';

CREATE INDEX IF NOT EXISTS idx_ref_document_categories_portal_group
    ON ref_document_categories(portal_group, sort_order, id);
