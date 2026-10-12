-- Delivery status of sign-in e-mails (owner request 2026-10-05: the staff
-- should see whether the access e-mail arrived). The server asks Mittaro for
-- the status of each accepted message (`GET /v1/emails/{id}`) for three days
-- after sending; see `crate::mail::delivery`. Metadata only, like the rest of
-- the row.
ALTER TABLE portal_login_emails
    ADD COLUMN delivery_status TEXT CHECK (delivery_status IN (
        'queued', 'sending', 'sent', 'delivered', 'deferred',
        'bounced', 'failed', 'suppressed', 'complained', 'unknown'
    )),
    -- The provider's own status word and SMTP code, as reported.
    ADD COLUMN provider_status TEXT CHECK (char_length(provider_status) <= 64),
    ADD COLUMN smtp_code TEXT CHECK (char_length(smtp_code) <= 16),
    -- No further checks: delivered, bounced, failed, suppressed, complained,
    -- or a message the provider does not know.
    ADD COLUMN delivery_final BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN delivery_updated_at TIMESTAMPTZ,
    ADD COLUMN delivery_checked_at TIMESTAMPTZ;

CREATE INDEX portal_login_emails_delivery_due_idx
    ON portal_login_emails (created_at)
    WHERE status = 'sent' AND NOT delivery_final;
