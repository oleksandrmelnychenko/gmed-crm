-- Lead cabinet, GwG: the points-based risk assessment of a lead ("Trigger-Ablauf
-- im Detail", owner spec 2026-10-07). The system computes and shows; staff
-- decide. See docs/architecture/aml-enhanced-due-diligence_ua.md, section
-- «Тригери й рівні ризику».

-- One row per lead: the current state. Written only by `risk::store::reassess`
-- and the staff decisions. `triggers` is the sticky list (a fired trigger stays
-- at its highest points, P3); `active` in an entry is information only.
CREATE TABLE IF NOT EXISTS lead_risk_assessments (
    lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    -- NULL while the assessment has not started (a grandfathered lead).
    started_at TIMESTAMPTZ,
    config_version INTEGER NOT NULL DEFAULT 1,
    patient_points INTEGER NOT NULL DEFAULT 0 CHECK (patient_points >= 0),
    payer_points INTEGER NOT NULL DEFAULT 0 CHECK (payer_points >= 0),
    points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    knockout BOOLEAN NOT NULL DEFAULT false,
    level SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
    triggers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(triggers) = 'array'),
    -- Sorted `key:subject:points` of the sticky triggers.
    fingerprint TEXT NOT NULL DEFAULT '',
    -- Blocks staff requested (`request_more`), letters A-J.
    requested_blocks TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        requested_blocks <@ ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']::text[]
    ),
    follow_up_answered_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (
        status IN (
            'clear',
            'awaiting_answers',
            'review_required',
            'proposed',
            'released',
            'rejected',
            'grandfathered'
        )
    ),
    released_fingerprint TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_risk_assessments_queue
    ON lead_risk_assessments (status, updated_at)
    WHERE status IN ('review_required', 'proposed', 'awaiting_answers');

-- History, append-only (docs/engineering/02_audit-migration-policy_ua.md):
-- one row whenever something changed. Keys and numbers only, no answers.
CREATE TABLE IF NOT EXISTS lead_risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL CHECK (
        kind IN ('started', 'raised', 'follow_up_answered', 'trigger_withdrawn', 'status')
    ),
    level SMALLINT CHECK (level IS NULL OR level BETWEEN 1 AND 3),
    points INTEGER,
    patient_points INTEGER,
    payer_points INTEGER,
    triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- The status after the event.
    status TEXT,
    cause TEXT NOT NULL CHECK (
        cause IN (
            'cabinet',
            'staff',
            'payer_link',
            'screening',
            'hit_decision',
            'gate',
            'read',
            'config'
        )
    ),
    actor UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_risk_events_lead ON lead_risk_events (lead_id, at);

-- Staff decisions, append-only. A confirmation (four eyes, level 3) and a
-- withdrawal of a proposal are rows of their own.
CREATE TABLE IF NOT EXISTS lead_risk_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('release', 'request_more', 'reject')),
    reason TEXT NOT NULL CHECK (
        length(trim(reason)) >= 10 AND char_length(reason) <= 2000
    ),
    blocks TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        blocks <@ ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']::text[]
    ),
    level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
    fingerprint TEXT NOT NULL,
    decided_by UUID NOT NULL REFERENCES users(id),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirms_decision_id UUID REFERENCES lead_risk_decisions(id) ON DELETE CASCADE,
    withdraws_decision_id UUID REFERENCES lead_risk_decisions(id) ON DELETE CASCADE,
    CHECK (confirms_decision_id IS NULL OR withdraws_decision_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_lead_risk_decisions_lead
    ON lead_risk_decisions (lead_id, decided_at);

-- Append-only: no UPDATE, no DELETE — except the cascade when the lead itself
-- is deleted (the 14-day retention purge), which arrives through the
-- foreign-key trigger (nesting depth > 1).
CREATE OR REPLACE FUNCTION lead_risk_history_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_risk_events_append_only ON lead_risk_events;
CREATE TRIGGER trg_lead_risk_events_append_only
    BEFORE UPDATE OR DELETE ON lead_risk_events
    FOR EACH ROW EXECUTE FUNCTION lead_risk_history_append_only();

DROP TRIGGER IF EXISTS trg_lead_risk_decisions_append_only ON lead_risk_decisions;
CREATE TRIGGER trg_lead_risk_decisions_append_only
    BEFORE UPDATE OR DELETE ON lead_risk_decisions
    FOR EACH ROW EXECUTE FUNCTION lead_risk_history_append_only();

-- Four eyes: the confirmation of a proposal is never by its proposer (the
-- server checks it first and answers 409 `four_eyes_same_user`).
CREATE OR REPLACE FUNCTION lead_risk_decisions_four_eyes() RETURNS trigger AS $$
DECLARE
    proposer UUID;
BEGIN
    IF NEW.confirms_decision_id IS NOT NULL THEN
        SELECT decided_by INTO proposer
        FROM lead_risk_decisions
        WHERE id = NEW.confirms_decision_id;
        IF proposer IS NOT NULL AND proposer = NEW.decided_by THEN
            RAISE EXCEPTION 'four_eyes_same_user' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_risk_decisions_four_eyes ON lead_risk_decisions;
CREATE TRIGGER trg_lead_risk_decisions_four_eyes
    BEFORE INSERT ON lead_risk_decisions
    FOR EACH ROW EXECUTE FUNCTION lead_risk_decisions_four_eyes();

-- The patient's identity document data are staff's now (the lead only uploads
-- the document); the follow-up blocks F, B, H, J; the lead's own reason of the
-- request (13.1, medical: shown only to roles with medical access, never
-- overwriting staff's `primary_concern_text`, purged with the GwG statements).
ALTER TABLE lead_gwg_declarations
    ADD COLUMN IF NOT EXISTS id_document_unreadable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS id_data_entered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS id_data_entered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS residence_since TEXT CHECK (
        residence_since IS NULL OR char_length(residence_since) <= 60
    ),
    ADD COLUMN IF NOT EXISTS other_residences TEXT CHECK (
        other_residences IS NULL OR char_length(other_residences) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS former_citizenships TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        array_to_string(former_citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'
    ),
    ADD COLUMN IF NOT EXISTS stay_reason TEXT CHECK (
        stay_reason IS NULL OR stay_reason IN ('work', 'study', 'family', 'other')
    ),
    ADD COLUMN IF NOT EXISTS stay_reason_details TEXT CHECK (
        stay_reason_details IS NULL OR char_length(stay_reason_details) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS relationship_since TEXT CHECK (
        relationship_since IS NULL OR char_length(relationship_since) <= 100
    ),
    ADD COLUMN IF NOT EXISTS pep_office TEXT CHECK (
        pep_office IS NULL OR char_length(pep_office) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS pep_country TEXT CHECK (
        pep_country IS NULL OR pep_country ~ '^[A-Z]{2}$'
    ),
    ADD COLUMN IF NOT EXISTS pep_period TEXT CHECK (
        pep_period IS NULL OR char_length(pep_period) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS pep_relationship TEXT CHECK (
        pep_relationship IS NULL OR char_length(pep_relationship) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS pep_wealth_origin TEXT CHECK (
        pep_wealth_origin IS NULL OR char_length(pep_wealth_origin) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS sanctions_link_name TEXT CHECK (
        sanctions_link_name IS NULL OR char_length(sanctions_link_name) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS sanctions_link_kind TEXT CHECK (
        sanctions_link_kind IS NULL
        OR sanctions_link_kind IN ('family', 'business', 'ownership', 'other')
    ),
    ADD COLUMN IF NOT EXISTS sanctions_link_since_extent TEXT CHECK (
        sanctions_link_since_extent IS NULL OR char_length(sanctions_link_since_extent) <= 2000
    ),
    ADD COLUMN IF NOT EXISTS request_reason TEXT CHECK (
        request_reason IS NULL OR char_length(request_reason) <= 4000
    ),
    ADD COLUMN IF NOT EXISTS request_reason_updated_at TIMESTAMPTZ;

ALTER TABLE lead_representatives
    ADD COLUMN IF NOT EXISTS id_document_unreadable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS id_data_entered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS id_data_entered_at TIMESTAMPTZ;

-- The organisation mask of "who pays" and block C (payment route).
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS organisation_legal_form TEXT CHECK (
        organisation_legal_form IS NULL OR char_length(organisation_legal_form) <= 100
    ),
    ADD COLUMN IF NOT EXISTS organisation_register_number TEXT CHECK (
        organisation_register_number IS NULL OR char_length(organisation_register_number) <= 60
    ),
    ADD COLUMN IF NOT EXISTS organisation_contact_name TEXT CHECK (
        organisation_contact_name IS NULL OR char_length(organisation_contact_name) <= 200
    ),
    ADD COLUMN IF NOT EXISTS expected_total_eur NUMERIC(12, 2) CHECK (
        expected_total_eur IS NULL OR expected_total_eur >= 0
    ),
    ADD COLUMN IF NOT EXISTS via_third_party_kind TEXT CHECK (
        via_third_party_kind IS NULL OR via_third_party_kind IN ('person', 'psp')
    );

-- Block E on the payer's own link (an organisation).
ALTER TABLE lead_payer_statements
    ADD COLUMN IF NOT EXISTS legal_form TEXT CHECK (
        legal_form IS NULL OR char_length(legal_form) <= 100
    ),
    ADD COLUMN IF NOT EXISTS vat_id TEXT CHECK (vat_id IS NULL OR char_length(vat_id) <= 20),
    ADD COLUMN IF NOT EXISTS payment_reason TEXT CHECK (
        payment_reason IS NULL OR char_length(payment_reason) <= 2000
    );

-- New upload kinds: the proof of the relationship to the payer (block B) and
-- the identity document of an organisation's representative (block E). The
-- kinds already allowed are kept as they are (also kinds of migrations this
-- file does not know).
DO $$
DECLARE
    definition TEXT;
    kinds TEXT[];
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO definition
    FROM pg_constraint c
    WHERE c.conrelid = 'lead_portal_uploads'::regclass
      AND c.conname = 'lead_portal_uploads_kind_check';
    SELECT array_agg(DISTINCT m[1]) INTO kinds
    FROM regexp_matches(COALESCE(definition, ''), '''([a-z_]+)''', 'g') AS m;
    kinds := ARRAY(
        SELECT DISTINCT unnest(
            COALESCE(kinds, '{}'::text[])
            || ARRAY[
                'medical',
                'identity',
                'representative_identity',
                'representative_authority',
                'payer_identity',
                'payer_funds_proof',
                'self_funds_proof',
                'relationship_proof',
                'payer_representative_identity'
            ]
        )
        ORDER BY 1
    );
    EXECUTE 'ALTER TABLE lead_portal_uploads DROP CONSTRAINT IF EXISTS lead_portal_uploads_kind_check';
    EXECUTE format(
        'ALTER TABLE lead_portal_uploads ADD CONSTRAINT lead_portal_uploads_kind_check '
        'CHECK (kind = ANY (%L::text[]))',
        kinds
    );
END $$;

-- The validity date of the identity document staff kept in the wizard state
-- becomes the one place, `lead_gwg_declarations.id_valid_until`, where it is
-- still empty. Values that are no valid date are skipped.
DO $$
DECLARE
    item RECORD;
    valid_until DATE;
BEGIN
    FOR item IN
        SELECT l.id, btrim(l.wizard_state ->> 'passport_expiry') AS value
        FROM leads l
        LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
        WHERE jsonb_typeof(l.wizard_state) = 'object'
          AND l.wizard_state ->> 'passport_expiry' ~ '^\s*\d{4}-\d{2}-\d{2}\s*$'
          AND g.id_valid_until IS NULL
    LOOP
        BEGIN
            valid_until := to_date(item.value, 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;
        INSERT INTO lead_gwg_declarations (lead_id, id_valid_until)
        VALUES (item.id, valid_until)
        ON CONFLICT (lead_id) DO UPDATE
        SET id_valid_until = EXCLUDED.id_valid_until
        WHERE lead_gwg_declarations.id_valid_until IS NULL;
    END LOOP;
END $$;

-- Leads already qualified or converted are not held by the new gates: they
-- are grandfathered (staff may still start a review).
INSERT INTO lead_risk_assessments (lead_id, started_at, status)
SELECT l.id, NULL, 'grandfathered'
FROM leads l
WHERE l.qualification_status IN ('qualified', 'converted')
   OR l.converted_patient_id IS NOT NULL
ON CONFLICT (lead_id) DO NOTHING;
