-- "Кто платит" / payer declaration of a lead (owner decision 2026-10-03).
--
-- Part of the compliance step of the lead wizard (GwG § 10 Abs. 1 Nr. 2 and 3,
-- § 11): who pays for the order, whether the client acts on own account or for
-- a beneficial owner, the source of the funds, and for a third-party payer the
-- payer's identity, residence and citizenships. One declaration per lead.
--
-- Agent B's sanctions screening reads lead_id, payer_kind, first_name,
-- last_name, date_of_birth, citizenships and country: keep these names.
--
-- A third-party payer signs a Kostenübernahmeerklärung (Schuldbeitritt); GMED
-- countersigns the framework contract and the order only once it is signed.
-- `identity_changed_at` dates the payer named in a cost assumption document:
-- a document created before the payer changed no longer counts.
CREATE TABLE IF NOT EXISTS lead_payer_declarations (
    lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    -- Set on conversion: the patient the declaration now belongs to (GwG
    -- records are kept with the business relationship, § 8 Abs. 4 GwG).
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    payer_kind TEXT NOT NULL CHECK (payer_kind IN ('self', 'third_party')),
    acts_on_own_account BOOLEAN NOT NULL DEFAULT true,
    beneficial_owner_name TEXT,
    beneficial_owner_note TEXT,
    source_of_funds TEXT CHECK (
        source_of_funds IS NULL
        OR source_of_funds IN (
            'employment',
            'business_income',
            'savings',
            'asset_sale',
            'inheritance_gift',
            'other'
        )
    ),
    source_of_funds_description TEXT,
    source_of_funds_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    first_name TEXT,
    last_name TEXT,
    date_of_birth DATE,
    -- GwG § 11 Abs. 4 Nr. 1 lists the place of birth; optional until the
    -- lawyer confirms whether the payer must be identified that far.
    place_of_birth TEXT,
    street TEXT,
    zip TEXT,
    city TEXT,
    country TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    citizenships TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (
        array_to_string(citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'
    ),
    relationship TEXT,
    email TEXT,
    phone TEXT,
    -- Staff confirmed that the third-party payer was informed about the
    -- processing of the payer's data (Art. 14 DSGVO: the data come from the
    -- patient side). Who and when; audited with every change.
    payer_informed_at TIMESTAMPTZ,
    payer_informed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    identity_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_payer_declarations_patient
    ON lead_payer_declarations (patient_id)
    WHERE patient_id IS NOT NULL;

-- A signed Kostenübernahmeerklärung is recorded with its own compliance kind,
-- so the wizard and the readiness checks can tell it from other signatures.
ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_compliance_kind_check;

ALTER TABLE documents
    ADD CONSTRAINT documents_compliance_kind_check
    CHECK (
        compliance_kind IS NULL
        OR compliance_kind IN (
            'dsgvo',
            'confidentiality_release',
            'identity',
            'framework_contract',
            'enhanced_due_diligence',
            'cost_coverage_declaration',
            'other'
        )
    );
