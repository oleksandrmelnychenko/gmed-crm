ALTER TABLE provider_doctors
    ADD COLUMN IF NOT EXISTS shared_identity_id UUID;

UPDATE provider_doctors
SET shared_identity_id = id
WHERE shared_identity_id IS NULL;

ALTER TABLE provider_doctors
    ALTER COLUMN shared_identity_id SET DEFAULT uuid_generate_v4(),
    ALTER COLUMN shared_identity_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_doctors_shared_identity
    ON provider_doctors(shared_identity_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_doctors_provider_shared_identity_unique
    ON provider_doctors(provider_id, shared_identity_id);
