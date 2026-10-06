-- Owner decision 2026-10-07: chat messages and attachments are encrypted at
-- rest with the server's message keys instead of end-to-end. A participant's
-- browser that can still decrypt an old end-to-end message hands the text (or
-- the attachment bytes) back once; the server stores it server-encrypted and
-- records who converted it and when. Content never reaches these columns.
ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS converted_from_e2e_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS attachment_converted_from_e2e_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attachment_converted_by UUID REFERENCES users(id) ON DELETE SET NULL;
