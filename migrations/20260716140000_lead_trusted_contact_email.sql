ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS trusted_contact_email TEXT;
