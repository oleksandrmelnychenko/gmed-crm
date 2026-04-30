ALTER TABLE patient_recommendations
    ADD COLUMN IF NOT EXISTS source_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_recommendations_source_order
    ON patient_recommendations(source_order_id)
    WHERE source_order_id IS NOT NULL;

ALTER TABLE document_translation_requests
    ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS translated_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_translation_requests_assigned
    ON document_translation_requests(assigned_to, status, requested_at DESC)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_translation_requests_translated_document
    ON document_translation_requests(translated_document_id)
    WHERE translated_document_id IS NOT NULL;

INSERT INTO ref_document_categories (
    id, name_de, name_en, is_medical, description, portal_group, sort_order, patient_visible
) VALUES
    ('invoice', 'Rechnung', 'Invoice', false, 'Patient-facing invoice documents and billing correspondence.', 'invoices', 70, true),
    ('conclusion', 'Arztlicher Abschluss / Befund', 'Conclusion / finding', true, 'Doctor conclusions, findings and discharge summaries.', 'conclusions', 30, true)
ON CONFLICT (id) DO UPDATE SET
    name_de = EXCLUDED.name_de,
    name_en = EXCLUDED.name_en,
    is_medical = EXCLUDED.is_medical,
    description = EXCLUDED.description,
    portal_group = EXCLUDED.portal_group,
    sort_order = EXCLUDED.sort_order,
    patient_visible = EXCLUDED.patient_visible;

UPDATE ref_document_categories
SET portal_group = 'correspondence', sort_order = 10
WHERE id IN ('clinic_correspondence', 'clinic_form', 'administrative', 'portal_upload');

UPDATE ref_document_categories
SET portal_group = 'analyses', sort_order = 20
WHERE id = 'lab_analysis';

UPDATE ref_document_categories
SET portal_group = 'conclusions', sort_order = 30
WHERE id IN ('medical_report', 'medical', 'conclusion', 'generated');

UPDATE ref_document_categories
SET portal_group = 'invoices', sort_order = 70
WHERE id IN ('finance', 'invoice');

UPDATE ref_document_categories
SET portal_group = 'translations', sort_order = 80
WHERE id = 'translation';
