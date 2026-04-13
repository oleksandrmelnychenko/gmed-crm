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
        message IS NOT NULL
        OR message_ciphertext IS NOT NULL
        OR e2e_ciphertext IS NOT NULL
        OR attachment_key IS NOT NULL
    );
