INSERT INTO system_settings (key, value, description) VALUES
    ('agency_principal_birth_date', '""', 'Birth date of the agency responsible person used in legal documents (YYYY-MM-DD)'),
    ('agency_privacy_email', '""', 'Privacy contact email rendered in generated legal documents'),
    ('agency_sign_place', '"München"', 'Default agency signature place used in generated documents'),
    ('agency_data_system_name', '"GMED-CRM-System"', 'Configured system name used for document data-processing consent'),
    ('agency_data_processor_notice', '""', 'Optional exact processor or international-transfer notice rendered in consent documents')
ON CONFLICT (key) DO NOTHING;
