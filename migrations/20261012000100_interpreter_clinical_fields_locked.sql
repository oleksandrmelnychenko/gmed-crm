-- Owner rule 2026-09-28 (docs/backlog/02_rbac-matrix_ua.md): the clinical
-- record is closed to interpreters under any assignment, and the server
-- refuses it to `interpreter` and `teamlead_interpreter` alike. The field
-- matrix (/admin/access) still showed the interpreter's diagnoses,
-- medications and allergies as "conditional" and let them be enabled
-- (QA E-42, 2026-10-11). These fields are now hidden and system locked for
-- both interpreter roles, so no administrator can open them.
INSERT INTO field_access_policies (
    role,
    entity_type,
    field_name,
    access_level,
    condition_type,
    is_system_locked
)
VALUES
    ('interpreter', 'patient', 'diagnosis', 'hidden', NULL, true),
    ('interpreter', 'patient', 'medications', 'hidden', NULL, true),
    ('interpreter', 'patient', 'allergies', 'hidden', NULL, true),
    ('interpreter', 'patient', 'vitals', 'hidden', NULL, true),
    ('teamlead_interpreter', 'patient', 'diagnosis', 'hidden', NULL, true),
    ('teamlead_interpreter', 'patient', 'medications', 'hidden', NULL, true),
    ('teamlead_interpreter', 'patient', 'allergies', 'hidden', NULL, true),
    ('teamlead_interpreter', 'patient', 'vitals', 'hidden', NULL, true)
ON CONFLICT (role, entity_type, field_name) DO UPDATE
SET access_level = EXCLUDED.access_level,
    condition_type = EXCLUDED.condition_type,
    is_system_locked = EXCLUDED.is_system_locked,
    updated_at = now();
