-- An explicit parent of the child receives the invoice, independently of
-- which parent's login filled in the questionnaire.
ALTER TABLE lead_invoice_recipients
    ADD COLUMN representative_contact_id UUID;
