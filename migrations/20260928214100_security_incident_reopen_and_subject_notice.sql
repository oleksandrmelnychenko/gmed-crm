-- Breach register (Art. 33, 34 DSGVO):
-- * a high-risk breach is communicated to the data subjects, or the reason for
--   not doing so (Art. 34 Abs. 3) is recorded, before the case is closed;
-- * a closed case is reopened only with a reason, kept with who and when.
ALTER TABLE security_incidents
    ADD COLUMN IF NOT EXISTS subjects_no_notification_reason TEXT,
    ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

COMMENT ON COLUMN security_incidents.subjects_no_notification_reason IS
    'Why the data subjects of a high-risk breach were not told (Art. 34 Abs. 3 DSGVO).';
COMMENT ON COLUMN security_incidents.reopen_reason IS
    'Reason given the last time the closed case was reopened; every reopening is audited.';
