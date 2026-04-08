ALTER TABLE direct_messages ALTER COLUMN message DROP NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'msg_or_attachment'
    ) THEN
        ALTER TABLE direct_messages ADD CONSTRAINT msg_or_attachment
            CHECK (message IS NOT NULL OR attachment_key IS NOT NULL);
    END IF;
END $$;
