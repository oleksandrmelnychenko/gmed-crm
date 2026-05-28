-- Dedicated category for generated agency contracts/orders, plus agency bank
-- details used by the cost-coverage declaration (Kostenübernahmeerklärung).

INSERT INTO ref_document_categories (
    id, name_de, name_en, is_medical, description, portal_group, sort_order, patient_visible
) VALUES
    ('contract', 'Vertrag', 'Contract', false, 'Framework service agreements, single orders and related contractual documents.', 'administrative', 55, true)
ON CONFLICT (id) DO UPDATE SET
    name_de = EXCLUDED.name_de,
    name_en = EXCLUDED.name_en,
    is_medical = EXCLUDED.is_medical,
    description = EXCLUDED.description,
    portal_group = EXCLUDED.portal_group,
    sort_order = EXCLUDED.sort_order,
    patient_visible = EXCLUDED.patient_visible;

INSERT INTO system_settings (key, value, description) VALUES
    ('agency_bank_holder', '""', 'Bank account holder used on cost-coverage declarations'),
    ('agency_bank_name',   '""', 'Bank name used on cost-coverage declarations'),
    ('agency_bank_swift',  '""', 'Bank SWIFT/BIC used on cost-coverage declarations'),
    ('agency_bank_iban',   '""', 'Bank IBAN used on cost-coverage declarations')
ON CONFLICT (key) DO NOTHING;
