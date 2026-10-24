-- Delivery status of the e-mails of a payer's link (invitation and
-- confirmation code), followed like the sign-in e-mails
-- (`crate::mail::delivery`, owner request 2026-10-24): staff learn when the
-- payer's address bounced. Metadata only, like the rest of the row.
ALTER TABLE lead_payer_link_emails
    ADD COLUMN delivery_status TEXT CHECK (delivery_status IN (
        'queued', 'sending', 'sent', 'delivered', 'deferred',
        'bounced', 'failed', 'suppressed', 'complained', 'unknown'
    )),
    ADD COLUMN provider_status TEXT CHECK (char_length(provider_status) <= 64),
    ADD COLUMN smtp_code TEXT CHECK (char_length(smtp_code) <= 16),
    ADD COLUMN delivery_final BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN delivery_updated_at TIMESTAMPTZ,
    ADD COLUMN delivery_checked_at TIMESTAMPTZ;

CREATE INDEX lead_payer_link_emails_delivery_due_idx
    ON lead_payer_link_emails (created_at)
    WHERE status = 'sent' AND NOT delivery_final;
