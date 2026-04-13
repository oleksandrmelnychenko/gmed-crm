ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS functional_labels TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO field_access_policies (
    role,
    entity_type,
    field_name,
    access_level,
    condition_type,
    is_system_locked
) VALUES
    ('patient_manager', 'patient', 'functional_labels', 'full', NULL, false),
    ('teamlead_interpreter', 'patient', 'functional_labels', 'full', NULL, false),
    ('interpreter', 'patient', 'functional_labels', 'full', NULL, false),
    ('concierge', 'patient', 'functional_labels', 'full', NULL, false),
    ('billing', 'patient', 'functional_labels', 'hidden', NULL, false),
    ('sales', 'patient', 'functional_labels', 'hidden', NULL, false),
    ('patient', 'patient', 'functional_labels', 'hidden', NULL, false)
ON CONFLICT (role, entity_type, field_name)
DO UPDATE SET
    access_level = EXCLUDED.access_level,
    condition_type = EXCLUDED.condition_type,
    is_system_locked = EXCLUDED.is_system_locked,
    updated_at = now();
