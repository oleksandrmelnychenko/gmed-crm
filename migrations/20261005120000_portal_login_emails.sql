-- Sign-in e-mails of lead logins (a lead's own login or a parent's login for
-- a minor's request), sent through Mittaro on a staff member's click.
-- Metadata only: the message content (with the password) is never stored.
-- The rows go with the lead: the retention purge deletes them
-- (`disable_for_lead_in_tx`), a deleted lead row cascades.
CREATE TABLE portal_login_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    recipient TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('de', 'en', 'ru', 'uk')),
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
    provider TEXT NOT NULL DEFAULT 'mittaro',
    provider_message_id TEXT,
    error_code TEXT,
    sent_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'sent') = (provider_message_id IS NOT NULL))
);

CREATE INDEX portal_login_emails_lead_idx ON portal_login_emails (lead_id, created_at DESC);
