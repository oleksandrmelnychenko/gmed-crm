-- Staff-only comment on the services step of the lead wizard (owner request
-- 2026-11-02). The per-service comments and the general comment of that step
-- are the client's own questionnaire answers and show in the lead cabinet;
-- this one never leaves staff: no portal, cabinet or payer-link endpoint reads
-- it and no client PDF prints it. Additive only: a nullable column, no data
-- rewritten. Its changes are audited in the transaction of the lead update
-- (`update_lead`, `services_internal_note_updated`), without the text.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS services_internal_note TEXT;

ALTER TABLE leads
    DROP CONSTRAINT IF EXISTS leads_services_internal_note_length_check,
    ADD CONSTRAINT leads_services_internal_note_length_check
        CHECK (services_internal_note IS NULL OR char_length(services_internal_note) <= 4000);

COMMENT ON COLUMN leads.services_internal_note IS
    'Staff-only comment on the services step of the lead wizard; never shown to the client (cabinet, payer link, client PDFs)';
