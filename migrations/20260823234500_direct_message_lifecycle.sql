ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS client_message_id UUID;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'msg_or_attachment'
    ) THEN
        ALTER TABLE direct_messages DROP CONSTRAINT msg_or_attachment;
    END IF;
END $$;

ALTER TABLE direct_messages
    ADD CONSTRAINT msg_or_attachment CHECK (
        deleted_at IS NOT NULL
        OR message IS NOT NULL
        OR message_ciphertext IS NOT NULL
        OR e2e_ciphertext IS NOT NULL
        OR attachment_key IS NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_direct_messages_expiry
    ON direct_messages(expires_at)
    WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_messages_visible_conversation
    ON direct_messages(
        LEAST(from_user, to_user),
        GREATEST(from_user, to_user),
        created_at DESC
    )
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_messages_sender_peer_client_id
    ON direct_messages(from_user, to_user, client_message_id)
    WHERE client_message_id IS NOT NULL;
