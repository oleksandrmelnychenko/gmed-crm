-- A lead that is not qualified within 14 days of its creation and has no signed
-- DSGVO consent is purged with everything it owns (owner decision 2026-10-01):
-- without consent there is no basis to keep its data and medical files.
--
-- * unqualified_lead_retention_days: the window; 0 switches the rule off.
-- * unqualified_lead_retention_effective_at: the moment the rule started in
--   this environment. Leads that already existed count their window from it,
--   so no lead disappears in the first night after the rollout.
INSERT INTO system_settings (key, value, description) VALUES
    (
        'unqualified_lead_retention_days',
        '14',
        'Purge a lead that is not qualified and has no signed DSGVO consent N days after its creation (0 = disabled)'
    ),
    (
        'unqualified_lead_retention_effective_at',
        to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'Start of the unqualified-lead retention rule; older leads count their window from this moment'
    )
ON CONFLICT (key) DO NOTHING;

-- The responsible user is warned once, three days before the deadline.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS retention_warning_sent_at TIMESTAMPTZ;
