INSERT INTO ref_document_categories (id, name_de, name_en, is_medical) VALUES
    ('medical', 'Medizinisch', 'Medical', true),
    ('administrative', 'Administrativ', 'Administrative', false),
    ('finance', 'Finanzen', 'Finance', false),
    ('identity', 'Identität', 'Identity', false),
    ('consent', 'Einwilligung', 'Consent', false),
    ('insurance', 'Versicherung', 'Insurance', false),
    ('portal_upload', 'Portal-Upload', 'Portal Upload', false),
    ('generated', 'Generiert', 'Generated', false)
ON CONFLICT (id) DO NOTHING;
