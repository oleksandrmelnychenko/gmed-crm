-- Lead cabinet, the payer's own link (owner spec "Patientenformular (Lead-Link)",
-- section 10, phase 3a, 2026-10-06): a third-party payer answers the GwG
-- questions about itself through a one-time link without an account, after a
-- code mailed to the link's address. A paying parent with a cabinet login
-- answers the same questions in the lead cabinet. See
-- docs/architecture/lead-payer-declaration_ua.md and lead-patient-portal_ua.md.

-- One link per sending. Only the SHA-256 of the token, of the current code and
-- of the session secret is stored; the token travels in the URL fragment and
-- in the `X-Payer-Link` header, never in a path or query. At most one link of
-- a lead is active; a resend revokes the previous one. `payer_key` is the
-- payer the link was sent for (type, organisation name, first and last name,
-- date of birth): another payer on the declaration makes the link invalid.
CREATE TABLE IF NOT EXISTS lead_payer_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL CHECK (char_length(email) <= 254),
    language TEXT NOT NULL CHECK (language IN ('de', 'en', 'ru', 'uk')),
    payer_key JSONB NOT NULL,
    sent_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    opened_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    -- The current e-mail code: hash of "<link id>:<code>", when it was sent
    -- and until when it counts; wrong tries of this code and of all codes.
    code_hash TEXT,
    code_sent_at TIMESTAMPTZ,
    code_expires_at TIMESTAMPTZ,
    code_attempts INTEGER NOT NULL DEFAULT 0 CHECK (code_attempts >= 0),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_at TIMESTAMPTZ,
    session_hash TEXT,
    session_expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_reason TEXT CHECK (
        revoked_reason IS NULL
        OR revoked_reason IN (
            'resent',
            'staff_revoked',
            'payer_changed',
            'email_changed',
            'lead_converted',
            'email_failed'
        )
    ),
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_payer_links_active
    ON lead_payer_links (lead_id)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_payer_links_lead
    ON lead_payer_links (lead_id, created_at DESC);

-- The invitations and codes mailed for a link. Metadata only: neither the
-- token nor the code is stored. `sent_by` is NULL for a code (the payer asked
-- for it). The rows go with the link.
CREATE TABLE IF NOT EXISTS lead_payer_link_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES lead_payer_links(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('invitation', 'code')),
    recipient TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('de', 'en', 'ru', 'uk')),
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
    provider_message_id TEXT,
    error_code TEXT,
    sent_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'sent') = (provider_message_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_lead_payer_link_emails_link
    ON lead_payer_link_emails (link_id, kind, created_at DESC);

-- What the payer states about itself, one row per lead. Section 8 (payment
-- route) stays on lead_payer_declarations. While the payer drafts, the
-- declaration is untouched; on "submit" the answers are completed from the
-- declaration (or, for a paying parent, from the representative's row) and
-- the payer's identity is adopted into the declaration. Staff add the
-- expected total. A change of the payer clears the answers; the row goes with
-- an unconverted lead and stays with a converted one (§ 8 Abs. 4 GwG).
CREATE TABLE IF NOT EXISTS lead_payer_statements (
    lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    -- `link`: the payer's own link; `cabinet`: a paying parent in the cabinet.
    source TEXT NOT NULL CHECK (source IN ('link', 'cabinet')),
    answered_by_user UUID REFERENCES users(id) ON DELETE SET NULL,
    link_id UUID REFERENCES lead_payer_links(id) ON DELETE SET NULL,
    payer_key JSONB,
    -- The payer read the privacy notice (Art. 13/14 DSGVO): first time kept.
    privacy_ack_at TIMESTAMPTZ,
    privacy_text_version TEXT CHECK (
        privacy_text_version IS NULL OR char_length(privacy_text_version) <= 60
    ),
    privacy_language TEXT CHECK (
        privacy_language IS NULL OR privacy_language IN ('de', 'en', 'ru', 'uk')
    ),
    privacy_ip TEXT CHECK (privacy_ip IS NULL OR char_length(privacy_ip) <= 45),
    contact_channels TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        contact_channels <@ ARRAY['email', 'phone', 'messenger']::text[]
        AND cardinality(contact_channels) <= 3
    ),
    confirmed_email TEXT CHECK (confirmed_email IS NULL OR char_length(confirmed_email) <= 254),
    email_confirmed_at TIMESTAMPTZ,
    -- A natural person.
    salutation TEXT CHECK (salutation IS NULL OR salutation IN ('mr', 'ms', 'none')),
    first_name TEXT CHECK (first_name IS NULL OR char_length(first_name) <= 100),
    last_name TEXT CHECK (last_name IS NULL OR char_length(last_name) <= 100),
    former_names TEXT CHECK (former_names IS NULL OR char_length(former_names) <= 200),
    date_of_birth DATE,
    birth_place TEXT CHECK (birth_place IS NULL OR char_length(birth_place) <= 200),
    birth_country TEXT CHECK (birth_country IS NULL OR birth_country ~ '^[A-Z]{2}$'),
    citizenships TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        array_to_string(citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'
    ),
    -- The address of a person, or the seat of an organisation.
    street TEXT CHECK (street IS NULL OR char_length(street) <= 200),
    city TEXT CHECK (city IS NULL OR char_length(city) <= 200),
    zip TEXT CHECK (zip IS NULL OR char_length(zip) <= 20),
    country TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    habitual_residence_country TEXT CHECK (
        habitual_residence_country IS NULL OR habitual_residence_country ~ '^[A-Z]{2}$'
    ),
    phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 200),
    language TEXT CHECK (language IS NULL OR language IN ('de', 'en', 'uk', 'ru')),
    -- The identity document of the person, or of the organisation's
    -- representative.
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
    -- A company, an organisation or an insurer.
    organisation_name TEXT CHECK (
        organisation_name IS NULL OR char_length(organisation_name) <= 200
    ),
    register_court TEXT CHECK (register_court IS NULL OR char_length(register_court) <= 200),
    register_number TEXT CHECK (register_number IS NULL OR char_length(register_number) <= 60),
    representative_first_name TEXT CHECK (
        representative_first_name IS NULL OR char_length(representative_first_name) <= 100
    ),
    representative_last_name TEXT CHECK (
        representative_last_name IS NULL OR char_length(representative_last_name) <= 100
    ),
    representative_role TEXT CHECK (
        representative_role IS NULL OR char_length(representative_role) <= 100
    ),
    beneficial_owners JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(beneficial_owners) = 'array' AND jsonb_array_length(beneficial_owners) <= 10
    ),
    beneficial_owners_none BOOLEAN,
    relationship_kind TEXT CHECK (
        relationship_kind IS NULL
        OR relationship_kind IN (
            'spouse',
            'parent',
            'child',
            'relative',
            'employer',
            'friend',
            'business_partner',
            'other'
        )
    ),
    relationship TEXT CHECK (relationship IS NULL OR char_length(relationship) <= 200),
    occupation TEXT CHECK (occupation IS NULL OR char_length(occupation) <= 200),
    industry TEXT CHECK (industry IS NULL OR char_length(industry) <= 200),
    funds_sources TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        funds_sources <@ ARRAY[
            'employment',
            'business_income',
            'savings',
            'asset_sale',
            'inheritance_gift',
            'other'
        ]::text[]
    ),
    funds_description TEXT CHECK (
        funds_description IS NULL OR char_length(funds_description) <= 2000
    ),
    -- The legal questions: NULL until answered; the details belong to a "yes".
    pep_self BOOLEAN,
    pep_self_details TEXT CHECK (
        pep_self_details IS NULL OR (pep_self IS TRUE AND char_length(pep_self_details) <= 2000)
    ),
    pep_related BOOLEAN,
    pep_related_details TEXT CHECK (
        pep_related_details IS NULL
        OR (pep_related IS TRUE AND char_length(pep_related_details) <= 2000)
    ),
    high_risk_country BOOLEAN,
    high_risk_country_code TEXT CHECK (
        high_risk_country_code IS NULL
        OR (high_risk_country IS TRUE AND high_risk_country_code ~ '^[A-Z]{2}$')
    ),
    sanctions_links BOOLEAN,
    sanctions_links_details TEXT CHECK (
        sanctions_links_details IS NULL
        OR (sanctions_links IS TRUE AND char_length(sanctions_links_details) <= 2000)
    ),
    -- Staff: the expected total of the request (check level 2 from 10 000 EUR).
    estimated_total_eur NUMERIC(12, 2) CHECK (
        estimated_total_eur IS NULL OR estimated_total_eur >= 0
    ),
    declared_correct_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    adopted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sanctions screening: the statement adds the payer's habitual residence and,
-- once submitted, the legal representative and the beneficial owners of a
-- company, so every change queues the lead (like the representatives).
CREATE OR REPLACE FUNCTION sanctions_enqueue_lead_of_payer_statement() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sanctions_enqueue('lead', OLD.lead_id);
        RETURN OLD;
    END IF;
    PERFORM sanctions_enqueue('lead', NEW.lead_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_lead_of_payer_statement ON lead_payer_statements;
CREATE TRIGGER trg_sanctions_enqueue_lead_of_payer_statement
    AFTER INSERT OR UPDATE OR DELETE ON lead_payer_statements
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_lead_of_payer_statement();

-- Uploads through the payer's link: a copy of the payer's identity document
-- (of an organisation: of its representative) and the proof of the source of
-- funds. Nobody's login uploaded them, so `uploaded_by` is NULL exactly for
-- `access_kind = 'payer'`; the link they came through is kept. The paying
-- parent's proof of funds from the cabinet has the parent's login as
-- uploader. No backfill: every existing row has an uploader and a lead login.
ALTER TABLE lead_portal_uploads
    ADD COLUMN IF NOT EXISTS payer_link_id UUID REFERENCES lead_payer_links(id) ON DELETE SET NULL;

ALTER TABLE lead_portal_uploads
    ALTER COLUMN uploaded_by DROP NOT NULL;

-- The kind check is named by migration 20261005190000, the access-kind check
-- was added inline with the column (20261003130000), so PostgreSQL named it
-- `lead_portal_uploads_access_kind_check`; a rehearsal on a copy whose checks
-- carry other names is covered by dropping every single-column check on the
-- two columns.
DO $$
DECLARE
    upload_check RECORD;
BEGIN
    FOR upload_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'lead_portal_uploads'::regclass
          AND a.attname IN ('kind', 'access_kind')
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE lead_portal_uploads DROP CONSTRAINT IF EXISTS %I',
                       upload_check.conname);
    END LOOP;
END $$;

ALTER TABLE lead_portal_uploads
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_kind_check,
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_access_kind_check,
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_payer_uploader_check,
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_payer_kind_check;
ALTER TABLE lead_portal_uploads
    ADD CONSTRAINT lead_portal_uploads_kind_check CHECK (
        kind IN (
            'medical',
            'identity',
            'representative_identity',
            'representative_authority',
            'payer_identity',
            'payer_funds_proof'
        )
    ),
    ADD CONSTRAINT lead_portal_uploads_access_kind_check CHECK (
        access_kind IN ('self', 'guardian', 'payer')
    ),
    ADD CONSTRAINT lead_portal_uploads_payer_uploader_check CHECK (
        (access_kind = 'payer') = (uploaded_by IS NULL)
    ),
    ADD CONSTRAINT lead_portal_uploads_payer_kind_check CHECK (
        kind NOT IN ('payer_identity', 'payer_funds_proof') OR representative_id IS NULL
    );
