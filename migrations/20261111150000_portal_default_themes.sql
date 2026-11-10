INSERT INTO system_settings (key, value, description) VALUES
    ('patient_portal_default_theme', '{"selectedId":"gmed-graphite","themes":[]}', 'Default theme for the patient portal'),
    ('lead_portal_default_theme', '{"selectedId":"gmed-graphite","themes":[]}', 'Default theme for the lead portal')
ON CONFLICT (key) DO NOTHING;
