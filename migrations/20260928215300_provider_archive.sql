-- Providers are archived instead of deleted (owner decision 2026-09-28, Q11):
-- appointments, order services, concierge services, shares and invoices keep
-- their provider. An archived provider is inactive, hidden from the registry
-- by default and refused on new records.
ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE providers
    DROP CONSTRAINT IF EXISTS providers_archived_inactive_check,
    ADD CONSTRAINT providers_archived_inactive_check
    CHECK (archived_at IS NULL OR is_active = false);

CREATE INDEX IF NOT EXISTS idx_providers_archived
    ON providers (archived_at)
    WHERE archived_at IS NOT NULL;
