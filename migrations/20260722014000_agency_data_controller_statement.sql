INSERT INTO system_settings (key, value, description)
VALUES (
    'agency_data_controller_statement',
    to_jsonb('Verantwortlich für die Verarbeitung Ihrer Daten ist Heorhii Hudiiev, geb. am 12.12.1994, Albert-Schweitzer-Straße 56, 81735 München, Deutschland'::text),
    'Vollständiger Text zur verantwortlichen Person im Datenschutz-Informationsblatt'
)
ON CONFLICT (key) DO NOTHING;
