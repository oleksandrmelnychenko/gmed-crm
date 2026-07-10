ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS intake_completed_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cases_lead_intake_completion
    ON cases (lead_id, intake_completed_at)
    WHERE lead_id IS NOT NULL;
