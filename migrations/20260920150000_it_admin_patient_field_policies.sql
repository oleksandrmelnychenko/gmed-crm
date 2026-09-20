-- Stage 5 of the role cabinets plan: the field-level matrix gets an explicit
-- `it_admin` column. The technical administrator never sees medical,
-- financial or identity data, so every patient field is hidden and the rows
-- are system locked (not editable from /admin/access). `ceo` stays implicit
-- full and is not a matrix row.
INSERT INTO field_access_policies (
    role,
    entity_type,
    field_name,
    access_level,
    condition_type,
    is_system_locked
)
VALUES
    ('it_admin', 'patient', 'name', 'hidden', NULL, true),
    ('it_admin', 'patient', 'birth_date', 'hidden', NULL, true),
    ('it_admin', 'patient', 'phone', 'hidden', NULL, true),
    ('it_admin', 'patient', 'email', 'hidden', NULL, true),
    ('it_admin', 'patient', 'nationality', 'hidden', NULL, true),
    ('it_admin', 'patient', 'languages', 'hidden', NULL, true),
    ('it_admin', 'patient', 'insurance', 'hidden', NULL, true),
    ('it_admin', 'patient', 'diagnosis', 'hidden', NULL, true),
    ('it_admin', 'patient', 'medications', 'hidden', NULL, true),
    ('it_admin', 'patient', 'allergies', 'hidden', NULL, true),
    ('it_admin', 'patient', 'vitals', 'hidden', NULL, true),
    ('it_admin', 'patient', 'internal_notes', 'hidden', NULL, true),
    ('it_admin', 'patient', 'travel_data', 'hidden', NULL, true),
    ('it_admin', 'patient', 'functional_labels', 'hidden', NULL, true)
ON CONFLICT (role, entity_type, field_name) DO UPDATE
SET access_level = EXCLUDED.access_level,
    condition_type = EXCLUDED.condition_type,
    is_system_locked = EXCLUDED.is_system_locked;
