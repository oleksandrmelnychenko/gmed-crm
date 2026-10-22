-- The invoice recipient has one source (owner go-ahead 2026-10-23):
-- `lead_invoice_recipients`. Until now it was kept twice — the answers of
-- cabinet step 3 in this table and their derived copy, "section 7", on
-- `lead_payer_declarations` (`invoice_to`, `invoice_name`, `invoice_street`,
-- `invoice_zip`, `invoice_city`, `invoice_country`, `invoice_email`), which
-- the server rewrote after every change (`sync_section_seven`). Requests sent
-- before 2026-10-11 had only section 7, and every reader fell back to it.
--
-- From now on the server derives section 7 when it reads
-- (`routes/lead_invoice_recipient.rs`, `section_seven`), and nothing writes the
-- seven columns any more. They stay as history; the USt-IdNr. and the
-- Steuernummer (`invoice_vat_id`, `invoice_tax_number`) remain staff fields
-- of the declaration.
--
-- 1. Two columns for the rows made from section 7:
--    * `legacy_name` — the free name of "another address" (`invoice_name`):
--      the old form asked "Name auf der Rechnung" without saying whether it is
--      a person or an organisation, so it is kept as written rather than
--      guessed into `first_name`/`last_name` or `organisation_name`;
--    * `from_section_seven` — the row was made here and the lead has not
--      changed the answers since. While it is set, a minor's only parent is
--      not named as recipient automatically: the old answer "to me" stays the
--      contracting party (the parents), as the invoices read it before.
--    The cabinet's next save of the answers clears both where they no longer
--    apply.
--
-- 2. A row for every lead whose declaration answered section 7 and that has
--    no row yet, mapped as the server read such a request until now
--    (`lead_invoice_recipient::derived`, removed with this migration):
--    * `self`  -> the patient side receives the invoice (`recipient = self`)
--                 with the e-mail for invoices; it pays unless a third party
--                 other than a minor's paying parent is named as payer;
--    * `payer` -> the third party named as payer receives and pays it: a
--                 person (name, address, contact, relationship) or an
--                 organisation (name, seat, contact), copied from the payer;
--    * `other` -> a third party at another address that does not pay: the
--                 address, the e-mail and the name as written (`legacy_name`).
--    "A minor's paying parent" follows `lead_representatives::payer_same_person`
--    as closely as SQL can: the lead is under 18 today, the payer is a person,
--    and a trusted contact named as parent or guardian has the payer's e-mail
--    or, without e-mails on both sides, the payer's name and date of birth.
--
-- 3. The check that "to the payer" needs a third party read the payer kind
--    together with section 7. Section 7 is no longer written when the payer
--    changes, so the check keeps only the allowed values.
ALTER TABLE lead_invoice_recipients
    ADD COLUMN IF NOT EXISTS legacy_name TEXT CHECK (
        legacy_name IS NULL OR char_length(legacy_name) <= 200
    ),
    ADD COLUMN IF NOT EXISTS from_section_seven BOOLEAN NOT NULL DEFAULT false;

INSERT INTO lead_invoice_recipients (
    lead_id, recipient, recipient_is_payer, recipient_type, first_name, last_name,
    organisation_name, street, zip, city, country, email, phone, relationship_kind,
    relationship, legacy_name, from_section_seven, updated_by
)
SELECT
    source.lead_id,
    CASE source.invoice_to WHEN 'self' THEN 'self' ELSE 'third_party' END,
    CASE source.invoice_to
        WHEN 'self' THEN source.payer_kind <> 'third_party' OR source.paying_parent
        WHEN 'payer' THEN true
        ELSE false
    END,
    CASE
        WHEN source.invoice_to <> 'payer' THEN NULL
        WHEN source.organisation THEN 'organisation'
        ELSE 'person'
    END,
    CASE WHEN source.invoice_to = 'payer' AND NOT source.organisation
        THEN left(NULLIF(btrim(source.first_name), ''), 100) END,
    CASE WHEN source.invoice_to = 'payer' AND NOT source.organisation
        THEN left(NULLIF(btrim(source.last_name), ''), 100) END,
    CASE WHEN source.invoice_to = 'payer' AND source.organisation
        THEN left(NULLIF(btrim(source.organisation_name), ''), 200) END,
    left(CASE source.invoice_to
        WHEN 'payer' THEN source.street
        WHEN 'other' THEN source.invoice_street
    END, 200),
    left(CASE source.invoice_to
        WHEN 'payer' THEN source.zip
        WHEN 'other' THEN source.invoice_zip
    END, 20),
    left(CASE source.invoice_to
        WHEN 'payer' THEN source.city
        WHEN 'other' THEN source.invoice_city
    END, 200),
    CASE
        WHEN source.invoice_to = 'payer' AND source.country ~ '^[A-Z]{2}$'
            THEN source.country
        WHEN source.invoice_to = 'other' AND source.invoice_country ~ '^[A-Z]{2}$'
            THEN source.invoice_country
    END,
    left(CASE source.invoice_to
        WHEN 'payer' THEN source.email
        ELSE source.invoice_email
    END, 254),
    CASE WHEN source.invoice_to = 'payer' THEN left(source.phone, 40) END,
    CASE
        WHEN source.invoice_to = 'payer'
             AND NOT source.organisation
             AND source.relationship_kind IN (
                 'spouse', 'parent', 'child', 'sibling', 'grandparent', 'relative',
                 'employer', 'friend', 'business_partner', 'other'
             )
            THEN source.relationship_kind
    END,
    CASE WHEN source.invoice_to = 'payer' AND NOT source.organisation
              AND source.relationship_kind = 'other'
        THEN left(source.relationship, 200) END,
    CASE WHEN source.invoice_to = 'other'
        THEN left(NULLIF(btrim(source.invoice_name), ''), 200) END,
    true,
    source.updated_by
FROM (
    SELECT
        d.lead_id, d.invoice_to, d.payer_kind, d.first_name, d.last_name,
        d.organisation_name, d.street, d.zip, d.city, d.country, d.email, d.phone,
        d.relationship_kind, d.relationship, d.invoice_name, d.invoice_street,
        d.invoice_zip, d.invoice_city, d.invoice_country, d.invoice_email, d.updated_by,
        (d.payer_kind = 'third_party'
         AND d.payer_type IS NOT NULL
         AND d.payer_type <> 'person') AS organisation,
        COALESCE(d.payer_kind = 'third_party'
         AND (d.payer_type IS NULL OR d.payer_type = 'person')
         AND l.date_of_birth > (current_date - INTERVAL '18 years')::date
         AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(l.trusted_contacts) = 'array'
                      THEN l.trusted_contacts ELSE '[]'::jsonb END
             ) AS contact
             WHERE lower(btrim(contact ->> 'relation'))
                       IN ('parent', 'mother', 'father', 'guardian')
               AND CASE
                   WHEN NULLIF(btrim(d.email), '') IS NOT NULL
                        AND NULLIF(btrim(contact ->> 'email'), '') IS NOT NULL
                       THEN lower(btrim(d.email)) = lower(btrim(contact ->> 'email'))
                   ELSE d.date_of_birth IS NOT NULL
                        AND contact ->> 'birth_date' = to_char(d.date_of_birth, 'YYYY-MM-DD')
                        AND lower(regexp_replace(
                                btrim(concat_ws(' ', d.first_name, d.last_name)), '\s+', ' ', 'g'))
                            = lower(regexp_replace(
                                btrim(contact ->> 'name'), '\s+', ' ', 'g'))
               END
         ), false) AS paying_parent
    FROM lead_payer_declarations d
    JOIN leads l ON l.id = d.lead_id
    WHERE d.invoice_to IN ('self', 'payer', 'other')
      AND NOT EXISTS (
          SELECT 1 FROM lead_invoice_recipients r WHERE r.lead_id = d.lead_id
      )
) AS source
ON CONFLICT (lead_id) DO NOTHING;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_invoice_to_check,
    ADD CONSTRAINT lead_payer_declarations_invoice_to_check CHECK (
        invoice_to IS NULL OR invoice_to IN ('self', 'payer', 'other')
    );
