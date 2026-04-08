ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_filename TEXT;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_key TEXT;
