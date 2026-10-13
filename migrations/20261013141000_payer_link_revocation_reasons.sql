-- Payer contact consent withdrawal and a paying parent's cabinet access
-- independently end an earlier payer invitation. Keep all historical reasons.
ALTER TABLE lead_payer_links
    DROP CONSTRAINT lead_payer_links_revoked_reason_check;

ALTER TABLE lead_payer_links
    ADD CONSTRAINT lead_payer_links_revoked_reason_check CHECK (
        revoked_reason IS NULL
        OR revoked_reason IN (
            'resent',
            'staff_revoked',
            'payer_changed',
            'email_changed',
            'lead_converted',
            'email_failed',
            'consent_withdrawn',
            'payer_has_cabinet_login'
        )
    );
