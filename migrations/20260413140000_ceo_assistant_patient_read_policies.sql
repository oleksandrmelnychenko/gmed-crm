INSERT INTO field_access_policies (
    role,
    entity_type,
    field_name,
    access_level,
    condition_type,
    is_system_locked
)
VALUES
    ('ceo_assistant', 'patient', 'name', 'full', NULL, false),
    ('ceo_assistant', 'patient', 'birth_date', 'full', NULL, false),
    ('ceo_assistant', 'patient', 'phone', 'full', NULL, false),
    ('ceo_assistant', 'patient', 'email', 'full', NULL, false),
    ('ceo_assistant', 'patient', 'nationality', 'full', NULL, false),
    ('ceo_assistant', 'patient', 'languages', 'full', NULL, false),
    ('ceo_assistant', 'patient', 'insurance', 'hidden', NULL, false),
    ('ceo_assistant', 'patient', 'diagnosis', 'hidden', NULL, true),
    ('ceo_assistant', 'patient', 'medications', 'hidden', NULL, true),
    ('ceo_assistant', 'patient', 'allergies', 'hidden', NULL, true),
    ('ceo_assistant', 'patient', 'vitals', 'hidden', NULL, true),
    ('ceo_assistant', 'patient', 'internal_notes', 'hidden', NULL, false),
    ('ceo_assistant', 'patient', 'travel_data', 'full', NULL, false),
    ('ceo_assistant', 'patient', 'functional_labels', 'hidden', NULL, false)
ON CONFLICT (role, entity_type, field_name) DO UPDATE
SET access_level = EXCLUDED.access_level,
    condition_type = EXCLUDED.condition_type,
    is_system_locked = EXCLUDED.is_system_locked;
