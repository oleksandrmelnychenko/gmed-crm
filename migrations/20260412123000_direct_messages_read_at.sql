ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

UPDATE direct_messages
SET read_at = COALESCE(read_at, created_at)
WHERE is_read
  AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_messages_read_at
    ON direct_messages(to_user, read_at)
    WHERE read_at IS NOT NULL;
