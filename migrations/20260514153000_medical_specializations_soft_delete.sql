-- Soft-delete provider specialization directory entries without breaking existing links.

ALTER TABLE medical_specializations
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_medical_specializations_deleted_at
    ON medical_specializations(deleted_at)
    WHERE deleted_at IS NULL;
