-- Owner decision 2026-10-11 (docs/backlog/02_rbac-matrix_ua.md): the CEO
-- Assistant reads everything, read-only: the clinical record and the medical
-- PDFs (`patients.medical.view`), the insurance, the internal notes and the
-- functional labels of the patient card. It changes nothing (no
-- `patients.edit`, no `patients.medical.edit`).
-- The field matrix (/admin/access) still showed these fields as hidden for
-- the assistant. They now show the real access: read ("full" for this
-- read-only role), system locked, so no administrator can turn them into
-- something the server does not do.
INSERT INTO field_access_policies (
    role,
    entity_type,
    field_name,
    access_level,
    condition_type,
    is_system_locked
)
VALUES
    ('ceo_assistant', 'patient', 'insurance', 'full', NULL, true),
    ('ceo_assistant', 'patient', 'diagnosis', 'full', NULL, true),
    ('ceo_assistant', 'patient', 'medications', 'full', NULL, true),
    ('ceo_assistant', 'patient', 'allergies', 'full', NULL, true),
    ('ceo_assistant', 'patient', 'vitals', 'full', NULL, true),
    ('ceo_assistant', 'patient', 'internal_notes', 'full', NULL, true),
    ('ceo_assistant', 'patient', 'functional_labels', 'full', NULL, true)
ON CONFLICT (role, entity_type, field_name) DO UPDATE
SET access_level = EXCLUDED.access_level,
    condition_type = EXCLUDED.condition_type,
    is_system_locked = EXCLUDED.is_system_locked,
    updated_at = now();
