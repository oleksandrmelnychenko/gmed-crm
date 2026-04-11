INSERT INTO system_settings (key, value, description) VALUES
    ('agency_name',    '"GMED"',      'Agency name used on patient labels and print blocks'),
    ('agency_care_of', '"c/o GMED"',  'Care-of line used on patient labels'),
    ('agency_address', '""',          'Agency address used on patient labels'),
    ('agency_phone',   '""',          'Agency phone used on patient labels'),
    ('agency_email',   '""',          'Agency email used on patient labels')
ON CONFLICT (key) DO NOTHING;
