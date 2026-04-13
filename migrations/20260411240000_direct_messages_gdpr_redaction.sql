ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS redaction_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_direct_messages_redacted_at
    ON direct_messages(redacted_at)
    WHERE redacted_at IS NOT NULL;
