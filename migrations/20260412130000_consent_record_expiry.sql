ALTER TABLE consent_records
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE consent_records
SET expires_at = COALESCE(granted_at, created_at) + INTERVAL '1 year'
WHERE granted = true
  AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_consent_patient_expiry
    ON consent_records(patient_id, expires_at)
    WHERE patient_id IS NOT NULL
      AND granted = true
      AND revoked_at IS NULL;
