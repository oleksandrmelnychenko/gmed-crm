INSERT INTO ref_document_categories (
    id, name_de, name_en, is_medical, description, portal_group, sort_order, patient_visible
) VALUES
    (
        'official',
        'Amtlich / Behördlich',
        'Official / agency documents',
        false,
        'Official correspondence and documents from public authorities, agencies and consulates.',
        'administrative',
        50,
        true
    ),
    (
        'personal',
        'Persönliche Dokumente',
        'Personal documents',
        false,
        'Passports, residence permits, birth certificates and similar personal identity records.',
        'administrative',
        52,
        true
    ),
    (
        'other',
        'Sonstige',
        'Other',
        false,
        'Documents that do not fit a more specific category yet.',
        'other',
        100,
        true
    )
ON CONFLICT (id) DO UPDATE SET
    name_de = EXCLUDED.name_de,
    name_en = EXCLUDED.name_en,
    is_medical = EXCLUDED.is_medical,
    description = EXCLUDED.description,
    portal_group = EXCLUDED.portal_group,
    sort_order = EXCLUDED.sort_order,
    patient_visible = EXCLUDED.patient_visible;
