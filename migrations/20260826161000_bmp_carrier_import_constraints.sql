-- Add validation and audit documentation without changing the checksum of the
-- already-applied base BMP import migration.

ALTER TABLE patient_bmp_imports
    ADD CONSTRAINT patient_bmp_imports_plan_instance_id_format
    CHECK (plan_instance_id ~ '^[A-F0-9]{32}$');

COMMENT ON COLUMN patient_bmp_imports.confirmed_by IS
    'Historical actor UUID intentionally has no user FK so staff erasure cannot rewrite the immutable clinical import audit.';
