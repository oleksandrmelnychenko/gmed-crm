-- Reminder e-mail to the lead before the 14-day deletion (owner decision
-- 2026-10-24): three days before the deadline, while the DSGVO package is
-- unsigned and the sweep would really delete the request, the lead's own
-- login (for a minor: each parent with active access) gets one neutral
-- e-mail. `leads.retention_reminder_sent_at` marks the lead as reminded in the
-- transaction that stores the rows below, so the reminder goes out once.
-- Metadata only, like the other e-mail logs; the rows go with the lead when
-- it is purged (`disable_for_lead_in_tx`).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS retention_reminder_sent_at TIMESTAMPTZ;

CREATE TABLE lead_retention_reminder_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    -- The login the e-mail went to (the lead's own or a parent's), if any.
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    audience TEXT NOT NULL CHECK (audience IN ('lead', 'guardian')),
    recipient TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('de', 'en', 'ru', 'uk')),
    -- `pending` between the marker's commit and Mittaro's answer.
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    provider_message_id TEXT,
    error_code TEXT,
    deadline_on DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    -- Delivery, as for the sign-in e-mails (`crate::mail::delivery`).
    delivery_status TEXT CHECK (delivery_status IN (
        'queued', 'sending', 'sent', 'delivered', 'deferred',
        'bounced', 'failed', 'suppressed', 'complained', 'unknown'
    )),
    provider_status TEXT CHECK (char_length(provider_status) <= 64),
    smtp_code TEXT CHECK (char_length(smtp_code) <= 16),
    delivery_final BOOLEAN NOT NULL DEFAULT false,
    delivery_updated_at TIMESTAMPTZ,
    delivery_checked_at TIMESTAMPTZ,
    CHECK ((status = 'sent') = (provider_message_id IS NOT NULL))
);

CREATE INDEX lead_retention_reminder_emails_lead_idx
    ON lead_retention_reminder_emails (lead_id, created_at DESC);
CREATE INDEX lead_retention_reminder_emails_delivery_due_idx
    ON lead_retention_reminder_emails (created_at)
    WHERE status = 'sent' AND NOT delivery_final;
