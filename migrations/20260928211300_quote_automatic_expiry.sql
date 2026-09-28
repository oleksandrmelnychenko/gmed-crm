-- Quotes carry a validity date ("Gültig bis") and now expire automatically:
-- an hourly scheduler moves `draft`/`sent` quotes whose `valid_until` day
-- (Europe/Berlin) has passed to `expired` (owner decision 2026-09-28, status
-- audit Q11). The system makes that change, so the version snapshot it writes
-- has no author; version lists show it as "System". Existing versions keep
-- their author.
ALTER TABLE quote_versions ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN quote_versions.created_by IS
    'Who made the change; NULL for a change the system made (automatic expiry).';

CREATE INDEX IF NOT EXISTS idx_quotes_open_valid_until
    ON quotes (valid_until)
    WHERE status IN ('draft', 'sent') AND valid_until IS NOT NULL;
