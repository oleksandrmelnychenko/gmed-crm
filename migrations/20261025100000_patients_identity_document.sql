-- The identity document staff recorded for a lead on the GwG statements
-- (lead_gwg_declarations.id_*) reaches the patient card with the conversion
-- (QA 2026-10-25: only the validity was copied, the number stayed NULL).
-- The card had a passport number and its expiry only; the type, the issuing
-- authority and country and the issue date get their own columns. Additive;
-- the values are the GwG sheet's (type: passport | id_card | residence_permit,
-- country: ISO 3166-1 alpha-2) and are written by the conversion only.
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS id_document_type TEXT,
    ADD COLUMN IF NOT EXISTS id_issuing_authority TEXT,
    ADD COLUMN IF NOT EXISTS id_issuing_country TEXT,
    ADD COLUMN IF NOT EXISTS id_issued_on DATE;

-- Patients converted before this migration: the number and the document data
-- the GwG statement of their lead holds, where the card has none.
UPDATE patients p
SET passport_number = COALESCE(p.passport_number, NULLIF(btrim(g.id_document_number), '')),
    passport_expiry = COALESCE(p.passport_expiry, g.id_valid_until),
    id_document_type = COALESCE(p.id_document_type, g.id_document_type),
    id_issuing_authority = COALESCE(p.id_issuing_authority, g.id_issuing_authority),
    id_issuing_country = COALESCE(p.id_issuing_country, g.id_issuing_country),
    id_issued_on = COALESCE(p.id_issued_on, g.id_issued_on)
FROM leads l
JOIN lead_gwg_declarations g ON g.lead_id = l.id
WHERE l.converted_patient_id = p.id
  AND p.source_lead_id = l.id
  AND (g.id_document_number IS NOT NULL OR g.id_document_type IS NOT NULL
       OR g.id_issuing_authority IS NOT NULL OR g.id_issuing_country IS NOT NULL
       OR g.id_issued_on IS NOT NULL OR g.id_valid_until IS NOT NULL);
