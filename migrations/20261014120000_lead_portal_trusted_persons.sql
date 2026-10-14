-- The trusted persons of a lead (owner decision 2026-10-14): people GMED may
-- tell about the person (or the child) — a grandmother, a son, a partner, a
-- friend. They have access to information only and never act on the person's
-- behalf (who acts is the representation of step 1). One list per lead, kept
-- in the lead cabinet under its own menu item «Vertrauenspersonen»: name, who
-- they are and how to reach them, at most five. The consent form's option
-- "named_recipients" prints this list (`consent_form_choices.recipients` keeps
-- the copy of each choice). Not sanctions-screened and not trusted contacts
-- of the lead; cleared with the lead's other cabinet data.

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS portal_trusted_persons JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE leads
    DROP CONSTRAINT IF EXISTS leads_portal_trusted_persons_check;
ALTER TABLE leads
    ADD CONSTRAINT leads_portal_trusted_persons_check
        CHECK (jsonb_typeof(portal_trusted_persons) = 'array'
               AND jsonb_array_length(portal_trusted_persons) <= 5);

-- The lists named so far live only in the consent choices: the newest choice
-- of a lead that names somebody becomes its trusted persons.
UPDATE leads l
SET portal_trusted_persons = newest.recipients
FROM (
    SELECT DISTINCT ON (c.lead_id) c.lead_id, c.recipients
    FROM consent_form_choices c
    JOIN leads subject ON subject.id = c.lead_id
    WHERE c.lead_id IS NOT NULL AND c.template_id = 'privacy_consents'
      -- Match consent_choices::current_for: a child's own choice never
      -- becomes the guardian's list, including after a corrected birth date.
      AND NOT (
          c.access_kind = 'self'
          AND subject.date_of_birth IS NOT NULL
          AND subject.date_of_birth
              > ((c.chosen_at AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years')
      )
    ORDER BY c.lead_id, c.seq DESC
) newest
WHERE newest.lead_id = l.id
  AND jsonb_typeof(newest.recipients) = 'array'
  AND jsonb_array_length(newest.recipients) BETWEEN 1 AND 5
  AND l.portal_trusted_persons = '[]'::jsonb;

COMMENT ON COLUMN leads.portal_trusted_persons IS
    'Trusted persons named in the lead cabinet (information only, never acting for the person): [{name, relation, contact}], at most 5; not sanctions-screened';
