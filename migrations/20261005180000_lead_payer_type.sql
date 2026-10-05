-- Lead cabinet, payer block (owner spec "Patientenformular (Lead-Link)",
-- sections 5 and 6, phase 1b-1, 2026-10-05): a third-party payer is a natural
-- person, a company, an organisation or an insurer; the relationship to the
-- patient is chosen from a list; the lead agrees that GMED contacts the payer.
-- See docs/architecture/lead-payer-declaration_ua.md.

ALTER TABLE lead_payer_declarations
    -- Who the third-party payer is. For anything but a person the
    -- natural-person columns (first_name, last_name, date_of_birth,
    -- place_of_birth, citizenships) stay empty; street, zip, city, country,
    -- email and phone are then the seat and the contact of the organisation.
    ADD COLUMN IF NOT EXISTS payer_type TEXT,
    -- Name of the company, organisation or insurer.
    ADD COLUMN IF NOT EXISTS organisation_name TEXT,
    -- Relationship of the payer to the patient; `relationship` keeps the free
    -- text for 'other' (and what was entered before the list existed).
    ADD COLUMN IF NOT EXISTS relationship_kind TEXT,
    -- When the lead agreed in the cabinet that GMED contacts the payer about
    -- the costs and tells the payer the lead's name. Only the lead gives or
    -- removes it; staff read it.
    ADD COLUMN IF NOT EXISTS contact_consent_at TIMESTAMPTZ;

-- Every third-party payer recorded so far is a natural person. The update
-- re-queues these leads for the sanctions screening (trigger on this table);
-- the screening is idempotent.
UPDATE lead_payer_declarations
SET payer_type = 'person'
WHERE payer_kind = 'third_party' AND payer_type IS NULL;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_payer_type_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_organisation_name_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_relationship_kind_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_contact_consent_check;

ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_payer_type_check CHECK (
        payer_type IS NULL
        OR (payer_kind = 'third_party'
            AND payer_type IN ('person', 'company', 'organisation', 'insurance'))
    ),
    ADD CONSTRAINT lead_payer_declarations_organisation_name_check CHECK (
        organisation_name IS NULL
        OR (payer_type IS NOT NULL
            AND payer_type IN ('company', 'organisation', 'insurance')
            AND char_length(organisation_name) <= 200)
    ),
    ADD CONSTRAINT lead_payer_declarations_relationship_kind_check CHECK (
        relationship_kind IS NULL
        OR (payer_kind = 'third_party'
            AND relationship_kind IN (
                'spouse', 'parent', 'child', 'relative', 'employer', 'friend',
                'business_partner', 'other'))
    ),
    ADD CONSTRAINT lead_payer_declarations_contact_consent_check CHECK (
        contact_consent_at IS NULL OR payer_kind = 'third_party'
    );

-- Sanctions screening: trg_sanctions_enqueue_lead_of_payer (migration
-- 20261004110000) queues the lead on every insert, update and delete of a
-- declaration row. Its function lists no columns, so a change of payer_type
-- or organisation_name queues the lead as well; nothing to recreate here.
