-- Lead cabinet, the payer's own link (QA retest 2026-10-06, R2-a): the payer's
-- identity was adopted from its own statement into the declaration. The lead's
-- cabinet keeps hiding that identity (date and place of birth, address,
-- citizenships, e-mail, phone) and refuses changes of the payer as long as the
-- declaration names that payer, also after a change of the payer's e-mail has
-- reset the statement itself. `identity_adopted_key` is the declaration's
-- payer key (type, organisation name, first and last name, date of birth) at
-- the adoption; a declaration that names another payer clears both columns.
-- See docs/architecture/lead-payer-declaration_ua.md.

ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS identity_adopted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS identity_adopted_key JSONB;

-- Declarations whose payer answered through its own link and still names that
-- payer: the adoption time and key of the statement. A third party without a
-- type is a person, as the server reads it.
UPDATE lead_payer_declarations d
SET identity_adopted_at = s.adopted_at,
    identity_adopted_key = s.payer_key
FROM lead_payer_statements s
WHERE s.lead_id = d.lead_id
  AND s.source = 'link'
  AND s.adopted_at IS NOT NULL
  AND s.payer_key IS NOT NULL
  AND d.payer_kind = 'third_party'
  AND d.identity_adopted_at IS NULL
  AND s.payer_key = jsonb_build_array(
      COALESCE(d.payer_type, 'person'),
      d.organisation_name,
      d.first_name,
      d.last_name,
      d.date_of_birth
  );
