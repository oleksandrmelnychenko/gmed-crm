ALTER TABLE user_notifications
    ADD COLUMN IF NOT EXISTS source_message_id UUID
        REFERENCES direct_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_notifications_source_message
    ON user_notifications(source_message_id)
    WHERE source_message_id IS NOT NULL;

-- Historical chat notifications may contain message excerpts, captions, or
-- filenames. Keep the navigation affordance while removing the independent
-- plaintext copy before new content-free notifications are written.
UPDATE user_notifications
   SET body = 'Open chat'
 WHERE entity_type = 'message_peer'
   AND kind IN ('direct_message', 'direct_message_attachment')
   AND body <> 'Open chat';

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_keyset
    ON direct_messages(
        LEAST(from_user, to_user),
        GREATEST(from_user, to_user),
        created_at DESC,
        id DESC
    )
    WHERE deleted_at IS NULL AND redacted_at IS NULL;

-- Enforce bounded, canonical E2E metadata for all new and updated rows while
-- allowing a safe deployment ahead of separately validating historical rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'user_message_keys_release_metadata_check'
           AND conrelid = 'user_message_keys'::regclass
    ) THEN
        ALTER TABLE user_message_keys
            ADD CONSTRAINT user_message_keys_release_metadata_check CHECK (
                octet_length(public_key) BETWEEN 1 AND 512
                AND fingerprint ~ '^[0-9a-f]{64}$'
            ) NOT VALID;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'direct_messages_release_metadata_check'
           AND conrelid = 'direct_messages'::regclass
    ) THEN
        ALTER TABLE direct_messages
            ADD CONSTRAINT direct_messages_release_metadata_check CHECK (
                (e2e_nonce IS NULL OR octet_length(e2e_nonce) = 12)
                AND (e2e_salt IS NULL OR octet_length(e2e_salt) = 16)
                AND (
                    sender_key_fingerprint IS NULL
                    OR sender_key_fingerprint ~ '^[0-9a-f]{64}$'
                )
                AND (
                    recipient_key_fingerprint IS NULL
                    OR recipient_key_fingerprint ~ '^[0-9a-f]{64}$'
                )
                AND (
                    attachment_filename IS NULL
                    OR octet_length(attachment_filename) <= 255
                )
                AND (
                    attachment_mime IS NULL
                    OR octet_length(attachment_mime) <= 255
                )
                AND (
                    attachment_e2e_nonce IS NULL
                    OR octet_length(attachment_e2e_nonce) = 12
                )
                AND (
                    attachment_e2e_salt IS NULL
                    OR octet_length(attachment_e2e_salt) = 16
                )
            ) NOT VALID;
    END IF;
END
$$;
