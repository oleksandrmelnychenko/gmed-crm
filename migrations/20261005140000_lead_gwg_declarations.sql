-- Lead cabinet, GwG form (owner spec "Patientenformular (Lead-Link)",
-- 2026-10-05): what the prospective patient states himself for the GwG
-- identification sheet. See docs/architecture/lead-patient-portal_ua.md.

-- The lead's own statements, one row per lead: place of birth, identity
-- document, the legal questions (PEP, high-risk country, sanctions) and the
-- confirmation that the statements are complete and true. Everything is
-- optional here; the cabinet requires the answers only for "send to the
-- manager". Staff do not edit these statements (their own AML assessment
-- stays in the wizard). The row goes with the lead.
CREATE TABLE IF NOT EXISTS lead_gwg_declarations (
    lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    salutation TEXT CHECK (salutation IS NULL OR salutation IN ('mr', 'ms', 'none')),
    former_names TEXT CHECK (former_names IS NULL OR char_length(former_names) <= 200),
    birth_place TEXT CHECK (birth_place IS NULL OR char_length(birth_place) <= 200),
    birth_country TEXT CHECK (birth_country IS NULL OR birth_country ~ '^[A-Z]{2}$'),
    -- Only when it differs from the residence (leads.country).
    habitual_residence_country TEXT CHECK (
        habitual_residence_country IS NULL OR habitual_residence_country ~ '^[A-Z]{2}$'
    ),
    -- How GMED may contact the lead; the server stores no duplicates.
    contact_channels TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        contact_channels <@ ARRAY['email', 'phone', 'messenger']::text[]
        AND cardinality(contact_channels) <= 3
    ),
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
    -- Each legal question: NULL until answered; the details belong to a "yes".
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
    -- Why a third person pays (asked with a third-party payer only).
    payment_background TEXT CHECK (
        payment_background IS NULL OR char_length(payment_background) <= 2000
    ),
    -- Set by the server when the request is sent with the confirmation "the
    -- information is complete and true"; who confirmed (the lead or a parent).
    declared_correct_at TIMESTAMPTZ,
    declared_correct_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Last change of the statements (the confirmation above does not count).
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Own economic interest (GwG § 10 Abs. 1 Nr. 2) is part of "who pays".
-- `acts_on_own_account` has always been NOT NULL DEFAULT true, so a row could
-- not say "nobody was asked yet". This flag does: true once the cabinet or
-- staff gave the answer explicitly.
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS own_account_answered BOOLEAN NOT NULL DEFAULT false;

-- Existing rows: the answer counts as given where staff clearly worked the
-- GwG part of the declaration — a source of funds is recorded (the staff form
-- saves it together with the own-account answer) or the answer is "no" (never
-- the default). A row that only names who pays (saved by the cabinet since
-- 2026-10-05, which did not ask the question) stays unanswered, so the cabinet
-- asks it. The update re-queues these leads for the sanctions screening
-- (trigger on this table); the screening is idempotent.
UPDATE lead_payer_declarations
SET own_account_answered = true
WHERE NOT own_account_answered
  AND (source_of_funds IS NOT NULL OR acts_on_own_account = false);

-- A portal upload is a medical document (uploaded under the Art. 9 consent)
-- or a photo / scan of the identity document (uploaded under the consent to
-- process the request data; never medical).
ALTER TABLE lead_portal_uploads
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'medical'
        CHECK (kind IN ('medical', 'identity'));
