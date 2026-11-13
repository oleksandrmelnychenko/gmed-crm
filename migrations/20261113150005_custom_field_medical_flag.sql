-- «Медицинское поле» of a custom field definition (security review
-- 2026-11-13, final-D S3-1): free-text custom fields were a side channel
-- around the medical redaction of leads and patients. The values of a medical
-- field are returned only to roles that read medical data (as the lead's
-- `medical_fields_hidden` and the patient's clinical record) and written only
-- by roles with `patients.medical.edit`. Existing fields stay non-medical; the
-- CEO marks them on /admin/custom-fields.

ALTER TABLE custom_fields
    ADD COLUMN IF NOT EXISTS is_medical BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN custom_fields.is_medical IS
    'true = the values are medical data: read only with patients.medical.view (not interpreters), written only with patients.medical.edit.';
