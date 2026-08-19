-- Patient subscriptions need an explicit release switch, independent from the
-- internal package lifecycle. Existing assignments stay visible to preserve
-- the behaviour patients already had through package-related next actions.
ALTER TABLE patient_service_packages
    ADD COLUMN IF NOT EXISTS portal_visible BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_patient_service_packages_portal
    ON patient_service_packages(patient_id, status, starts_on, ends_on)
    WHERE portal_visible = true
      AND status IN ('active', 'paused', 'completed');

COMMENT ON COLUMN patient_service_packages.portal_visible IS
    'Whether this concrete patient subscription is released in the patient portal.';
