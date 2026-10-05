-- Lead cabinet, representation (owner spec "Patientenformular (Lead-Link)",
-- section 3, phase 1b-2, 2026-10-05): who acts for the lead — an adult's
-- representative or legal guardian (Betreuer), and the legal representatives
-- of a minor. See docs/architecture/lead-patient-portal_ua.md.

-- Name and contact of a representative stay where parents have always been:
-- one entry of leads.trusted_contacts. This table holds only what that entry
-- cannot: the role, the name parts, place of birth, citizenships, the
-- structured address and the identity document. `contact_id` is the `id` of
-- the entry; date of birth, e-mail and phone are the entry's `birth_date`,
-- `email` and `phone`. A parent or guardian contact without a row is a
-- representative with empty extras (no backfill). The row goes with the lead.
CREATE TABLE IF NOT EXISTS lead_representatives (
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL,
    -- A minor's parent or guardian; an adult's representative (Vertreter,
    -- Bote, bevollmächtigte Person) or legal guardian (Betreuer).
    role TEXT NOT NULL CHECK (
        role IN ('legal_representative', 'authorised_representative', 'legal_guardian')
    ),
    -- `portal`: the cabinet created the trusted contact entry and may remove
    -- it again; `staff`: the entry existed before the cabinet added to it.
    contact_origin TEXT NOT NULL DEFAULT 'portal' CHECK (contact_origin IN ('portal', 'staff')),
    first_name TEXT CHECK (first_name IS NULL OR char_length(first_name) <= 100),
    last_name TEXT CHECK (last_name IS NULL OR char_length(last_name) <= 100),
    birth_place TEXT CHECK (birth_place IS NULL OR char_length(birth_place) <= 200),
    birth_country TEXT CHECK (birth_country IS NULL OR birth_country ~ '^[A-Z]{2}$'),
    citizenships TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        array_to_string(citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'
    ),
    street TEXT CHECK (street IS NULL OR char_length(street) <= 200),
    zip TEXT CHECK (zip IS NULL OR char_length(zip) <= 20),
    city TEXT CHECK (city IS NULL OR char_length(city) <= 200),
    country TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    id_document_type TEXT CHECK (
        id_document_type IS NULL
        OR id_document_type IN ('passport', 'id_card', 'residence_permit')
    ),
    id_document_number TEXT CHECK (
        id_document_number IS NULL OR char_length(id_document_number) <= 60
    ),
    id_issuing_authority TEXT CHECK (
        id_issuing_authority IS NULL OR char_length(id_issuing_authority) <= 200
    ),
    id_issuing_country TEXT CHECK (
        id_issuing_country IS NULL OR id_issuing_country ~ '^[A-Z]{2}$'
    ),
    id_issued_on DATE,
    id_valid_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (lead_id, contact_id)
);

-- An adult has at most one representative and one legal guardian.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_representatives_adult_role
    ON lead_representatives (lead_id, role)
    WHERE role IN ('authorised_representative', 'legal_guardian');

-- The answers that decide who is asked for. Adult: "does somebody act for
-- you?" and "are you under legal guardianship?" (NULL until answered). Minor:
-- who represents the child — both parents, one parent alone or a guardian;
-- NULL counts as `joint`. The parent sets it in the cabinet, staff may set it
-- in the wizard; the last write stands.
ALTER TABLE lead_gwg_declarations
    ADD COLUMN IF NOT EXISTS has_representative BOOLEAN,
    ADD COLUMN IF NOT EXISTS under_guardianship BOOLEAN,
    ADD COLUMN IF NOT EXISTS custody TEXT;

ALTER TABLE lead_gwg_declarations
    DROP CONSTRAINT IF EXISTS lead_gwg_declarations_custody_check;
ALTER TABLE lead_gwg_declarations
    ADD CONSTRAINT lead_gwg_declarations_custody_check CHECK (
        custody IS NULL OR custody IN ('joint', 'sole_parent', 'guardian')
    );

-- Portal uploads of a representative: a copy of the identity document and the
-- proof of authority (power of attorney, appointment deed, proof of custody).
-- They are never the lead's own identity document (`identity`). Deleting the
-- representative's row removes only this registry row; the document stays.
ALTER TABLE lead_portal_uploads
    ADD COLUMN IF NOT EXISTS representative_id UUID;

ALTER TABLE lead_portal_uploads
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_kind_check,
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_representative_check,
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_representative_fkey;
ALTER TABLE lead_portal_uploads
    ADD CONSTRAINT lead_portal_uploads_kind_check CHECK (
        kind IN ('medical', 'identity', 'representative_identity', 'representative_authority')
    ),
    ADD CONSTRAINT lead_portal_uploads_representative_check CHECK (
        (kind IN ('representative_identity', 'representative_authority'))
            = (representative_id IS NOT NULL)
    ),
    ADD CONSTRAINT lead_portal_uploads_representative_fkey
        FOREIGN KEY (lead_id, representative_id)
        REFERENCES lead_representatives (lead_id, contact_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_lead_portal_uploads_representative
    ON lead_portal_uploads (lead_id, representative_id)
    WHERE representative_id IS NOT NULL;

-- Staff's confirmation of the own-account payment (§ 12 Abs. 1 GwG): for a
-- minor each legal representative is a person of its own.
ALTER TABLE lead_identification_payments
    DROP CONSTRAINT IF EXISTS lead_identification_payments_subject_check;
ALTER TABLE lead_identification_payments
    ADD CONSTRAINT lead_identification_payments_subject_check CHECK (
        subject IN ('contract_partner', 'payer')
        OR subject ~ '^representative:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    );

-- Sanctions screening: a representative is screened as the lead's guardian
-- subject with the name parts, citizenships and residence of this table, so
-- every change of a row queues the lead (like the payer declaration).
CREATE OR REPLACE FUNCTION sanctions_enqueue_lead_of_representative() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sanctions_enqueue('lead', OLD.lead_id);
        RETURN OLD;
    END IF;
    PERFORM sanctions_enqueue('lead', NEW.lead_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_lead_of_representative ON lead_representatives;
CREATE TRIGGER trg_sanctions_enqueue_lead_of_representative
    AFTER INSERT OR UPDATE OR DELETE ON lead_representatives
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_lead_of_representative();

-- Data 1: the id of a trusted contact entry is the id of the representative,
-- so every entry of an open lead (neither deleted nor converted) needs one.
-- Entries written by the wizard have had one for long; older rows and imports
-- may not. Only arrays are touched (a value of another type is skipped), only
-- objects get an id, and an entry whose `id` already is a UUID keeps it. The
-- update queues these leads for the sanctions screening (trigger on leads):
-- the reference of such a parent changes from its position to the new id.
UPDATE leads AS l
SET trusted_contacts = fixed.contacts
FROM (
    SELECT entries.lead_id,
           jsonb_agg(
               CASE WHEN entries.needs_id
                        THEN entries.entry || jsonb_build_object('id', gen_random_uuid())
                    ELSE entries.entry
               END
               ORDER BY entries.position
           ) AS contacts
    FROM (
        SELECT lead.id AS lead_id,
               contact.entry,
               contact.position,
               -- An object without `id`, with a JSON null or with anything
               -- that is not a UUID in the usual notation.
               jsonb_typeof(contact.entry) = 'object'
               AND (
                   jsonb_typeof(contact.entry -> 'id') = 'string'
                   AND (contact.entry ->> 'id')
                       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               ) IS NOT TRUE AS needs_id
        FROM leads AS lead
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(lead.trusted_contacts) = 'array'
                 THEN lead.trusted_contacts ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS contact(entry, position)
        WHERE lead.qualification_status <> 'deleted'
          AND lead.converted_patient_id IS NULL
    ) AS entries
    GROUP BY entries.lead_id
    HAVING bool_or(entries.needs_id)
) AS fixed
WHERE l.id = fixed.lead_id;

-- Data 2: for a minor nothing counts for the child itself any more; each
-- parent or guardian has an own mark. A mark recorded so far for the
-- `contract_partner` of a minor lead was the confirmation of a parent's
-- payment and cannot be attributed to one of them: it goes, staff confirm the
-- payment again on the parent's line. The audit log keeps who confirmed it
-- and when. Converted leads keep theirs with the patient record.
DELETE FROM lead_identification_payments AS payment
USING leads AS lead
WHERE lead.id = payment.lead_id
  AND payment.subject = 'contract_partner'
  AND lead.converted_patient_id IS NULL
  AND lead.date_of_birth IS NOT NULL
  AND lead.date_of_birth > ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years');
