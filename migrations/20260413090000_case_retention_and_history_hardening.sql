ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_clinical_update_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS version_count INT NOT NULL DEFAULT 0;

UPDATE cases
SET retention_until = COALESCE(retention_until, created_at + INTERVAL '30 years'),
    last_clinical_update_at = COALESCE(last_clinical_update_at, updated_at, created_at);

UPDATE cases c
SET version_count = history.version_count
FROM (
    SELECT case_id, COUNT(*)::INT AS version_count
    FROM case_versions
    GROUP BY case_id
) AS history
WHERE history.case_id = c.id;

CREATE INDEX IF NOT EXISTS idx_cases_retention_until ON cases(retention_until);
CREATE INDEX IF NOT EXISTS idx_cases_last_clinical_update_at ON cases(last_clinical_update_at);

INSERT INTO system_settings (key, value, description)
VALUES (
    'clinical_case_retention_years',
    '30',
    'Retention period in years for medical case records and version history'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_case_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'case_versions is immutable — updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS case_versions_immutable ON case_versions;

CREATE TRIGGER case_versions_immutable
    BEFORE UPDATE OR DELETE ON case_versions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_case_version_mutation();
