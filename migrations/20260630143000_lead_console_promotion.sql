ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS console_promoted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS console_promoted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_console_promoted_at
    ON leads(console_promoted_at DESC)
    WHERE console_promoted_at IS NOT NULL;
