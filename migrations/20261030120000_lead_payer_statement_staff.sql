-- Staff enter the third-party payer's questionnaire from the signed paper
-- Selbstauskunft (owner rule 2026-10-29: everything the client or the payer
-- does online, staff can do from the wizard; DEV QA 2026-10-30). The answers
-- go into the same row and columns the payer's link writes, with
-- `source = 'staff'` and `answered_by_user` = the staff member: one data
-- model, one validation, and every reader (risk blocks C/D, the GwG sheets,
-- the payer's signature package) counts the sent paper answers like a sent
-- questionnaire. A staff send revokes a still active link with the reason
-- `paper_answers`.
ALTER TABLE lead_payer_statements
    DROP CONSTRAINT IF EXISTS lead_payer_statements_source_check;
ALTER TABLE lead_payer_statements
    ADD CONSTRAINT lead_payer_statements_source_check
        CHECK (source IN ('link', 'cabinet', 'staff'));

ALTER TABLE lead_payer_statement_archive
    DROP CONSTRAINT IF EXISTS lead_payer_statement_archive_source_check;
ALTER TABLE lead_payer_statement_archive
    ADD CONSTRAINT lead_payer_statement_archive_source_check
        CHECK (source IN ('link', 'cabinet', 'staff'));

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
            'payer_has_cabinet_login',
            'paper_answers'
        )
    );

COMMENT ON COLUMN lead_payer_statements.source IS
    'link: the payer''s own link; cabinet: a paying parent in the cabinet; '
    'staff: staff entered the answers of the signed paper Selbstauskunft (answered_by_user).';
