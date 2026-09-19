-- Storage limitation for finished patient files (Art. 5 Abs. 1 lit. e DSGVO).
-- The date a file went inactive starts the retention clock; a daily sweep
-- turns expired files into erasure requests for a human to review, so legal
-- holds and open claims are still checked before anything is anonymised.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS inactive_since TIMESTAMPTZ;

UPDATE patients
SET inactive_since = updated_at
WHERE lifecycle_status = 'inactive' AND inactive_since IS NULL;

CREATE INDEX IF NOT EXISTS idx_patients_inactive_since
    ON patients (inactive_since)
    WHERE lifecycle_status = 'inactive';

INSERT INTO system_settings (key, value, description) VALUES
    ('patient_file_retention_days', '1095',
     'Days after a patient file goes inactive before an erasure request is raised automatically for review')
ON CONFLICT (key) DO NOTHING;
