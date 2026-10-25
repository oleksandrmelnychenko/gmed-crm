-- «Нова заявка для цієї особи» (owner decision 2026-10-25): a parent,
-- guardian or other relation recorded on a patient (`patient_relations`) or
-- on an open request (`leads.trusted_contacts[]`) becomes a lead of their own
-- with the identity data GMED already holds pre-filled. The new lead
-- remembers where its data came from, so the conversion can point the
-- relation / the trusted contact at the new patient record
-- (`patient_relations.related_patient_id`,
-- `trusted_contacts[].related_patient_id`) without matching by e-mail.
--
-- Additive. A deleted relation or source lead leaves the new lead as it is
-- (SET NULL): the copied values are the lead's own data from the moment they
-- were copied; nothing else — no document, consent, signature, PEP answer or
-- payer declaration — is shared with the source.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS source_relation_id UUID
        REFERENCES patient_relations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_contact_lead_id UUID
        REFERENCES leads(id) ON DELETE SET NULL,
    -- `trusted_contacts[].id` on `source_contact_lead_id`.
    ADD COLUMN IF NOT EXISTS source_contact_id UUID;

COMMENT ON COLUMN leads.source_relation_id IS
    'patient_relations row this lead was pre-filled from («Neue Anfrage für diese Person»); the conversion links that relation to the new patient.';
COMMENT ON COLUMN leads.source_contact_lead_id IS
    'Lead whose trusted contact this lead was pre-filled from; with source_contact_id.';
COMMENT ON COLUMN leads.source_contact_id IS
    'trusted_contacts[].id on source_contact_lead_id this lead was pre-filled from.';

-- The conversion and the patient card look the source up by the relation /
-- the contact ("is there already a request for this person?").
CREATE INDEX IF NOT EXISTS idx_leads_source_relation
    ON leads (source_relation_id)
    WHERE source_relation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_source_contact
    ON leads (source_contact_lead_id, source_contact_id)
    WHERE source_contact_lead_id IS NOT NULL;
