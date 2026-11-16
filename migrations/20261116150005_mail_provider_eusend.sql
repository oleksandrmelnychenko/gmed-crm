-- Outgoing e-mail moves from Mittaro to eusend, a Resend-compatible API hosted
-- in Germany (owner decision 2026-11-16: remove Mittaro completely).
--
-- 1. The saved connection keeps its sender and reply-to, but the encrypted
--    Mittaro key is dropped and the connection is switched off: an old key is
--    useless at eusend, and the owner enters the eusend key on the API
--    connections page himself. The CHECK of `mail_provider_connection` allows
--    a disabled row with a sender and without a key. Audited once.
-- 2. Every e-mail log records the provider of its message. The rows written
--    so far are Mittaro's; the delivery check (`crate::mail::delivery`) only
--    asks eusend about eusend messages, so the Mittaro message ids are never
--    sent to eusend. Their last known status stays as history; messages still
--    being followed are closed (`delivery_final`) without changing the status.

WITH changed AS (
    UPDATE mail_provider_connection
    SET enabled = false,
        ciphertext = NULL,
        nonce = NULL,
        key_id = NULL,
        revision = gen_random_uuid(),
        updated_at = now()
    WHERE singleton
      AND (enabled OR ciphertext IS NOT NULL)
    RETURNING sender IS NOT NULL AS has_sender, reply_to IS NOT NULL AS has_reply_to
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'mail_connection_provider_changed',
       'mail_connection',
       NULL,
       jsonb_build_object(
           'from_provider', 'mittaro',
           'to_provider', 'eusend',
           'api_key_dropped', true,
           'enabled', false,
           'sender_kept', changed.has_sender,
           'reply_to_kept', changed.has_reply_to,
           'source', 'migration_20261116150005'
       )
FROM changed;

-- The sign-in e-mails already have the column; every row so far got the
-- default 'mittaro' (2026-10-05).
ALTER TABLE portal_login_emails ALTER COLUMN provider SET DEFAULT 'eusend';

ALTER TABLE lead_payer_link_emails
    ADD COLUMN provider TEXT NOT NULL DEFAULT 'mittaro';
ALTER TABLE lead_payer_link_emails ALTER COLUMN provider SET DEFAULT 'eusend';

ALTER TABLE lead_retention_reminder_emails
    ADD COLUMN provider TEXT NOT NULL DEFAULT 'mittaro';
ALTER TABLE lead_retention_reminder_emails ALTER COLUMN provider SET DEFAULT 'eusend';

UPDATE portal_login_emails SET delivery_final = true
WHERE status = 'sent' AND NOT delivery_final AND provider = 'mittaro';
UPDATE lead_payer_link_emails SET delivery_final = true
WHERE status = 'sent' AND NOT delivery_final AND provider = 'mittaro';
UPDATE lead_retention_reminder_emails SET delivery_final = true
WHERE status = 'sent' AND NOT delivery_final AND provider = 'mittaro';
