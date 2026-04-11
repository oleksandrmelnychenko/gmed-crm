-- Widen the leads table to absorb the full visitor-wizard payload.
-- The public wizard is the source of truth: every field collected on the site
-- is persisted here without loss. Manual leads (created by a manager in CRM)
-- use the same schema but leave wizard-only columns NULL.

-- --- Drop narrow legacy columns that no longer fit the model -----------------
-- `needs_medical` / `needs_non_medical` / `languages` are superseded by
-- `services[]` + `primary_language` from the wizard. There is no real data to
-- preserve at this stage, so we drop them cleanly.
ALTER TABLE leads DROP COLUMN IF EXISTS needs_medical;
ALTER TABLE leads DROP COLUMN IF EXISTS needs_non_medical;
ALTER TABLE leads DROP COLUMN IF EXISTS languages;

-- --- Ingest provenance -------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS flow TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS remote_ip INET;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Public submissions have no user. Allow NULL and enforce that either a user
-- or an intake source is present.
ALTER TABLE leads ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE leads
    ADD CONSTRAINT leads_origin_chk
    CHECK (created_by IS NOT NULL OR intake_source IS NOT NULL);

-- --- Identity ----------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS suffix TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS legal_sex TEXT
    CHECK (legal_sex IS NULL OR legal_sex IN ('female', 'male', 'diverse', 'no_entry'));

-- --- Contact -----------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_consent BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS primary_phone_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phones JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_consent BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

-- --- Address -----------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS street_address TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS zip_code TEXT;

-- --- Language ----------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS primary_language TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_interpreter BOOLEAN;

-- --- Eligibility path --------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS location_detailed TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wants_membership BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS selected_program TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS can_travel BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_medical_records TEXT
    CHECK (has_medical_records IS NULL OR has_medical_records IN ('yes', 'no', 'none'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS records_in_accepted_language BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_travel_documents BOOLEAN;

-- --- Health ------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS currently_in_treatment BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_health_risk_for_travel BOOLEAN;

-- --- Concern -----------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS primary_concern_text TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS additional_concerns TEXT;

-- --- Services & insurance ----------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_insurance BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS insurance_covers_germany TEXT
    CHECK (insurance_covers_germany IS NULL OR insurance_covers_germany IN ('yes', 'no', 'not_sure'));

-- --- Wrap up -----------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_location TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS visit_timing TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS message TEXT;

-- --- Consents ----------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_automated_contact BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_healthcare BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_opt_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_privacy_practices BOOLEAN NOT NULL DEFAULT false;

-- --- Raw snapshot ------------------------------------------------------------
-- Full wizard payload for future-proofing: any new field the wizard adds lands
-- here without requiring an immediate migration.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS raw_payload JSONB;

-- --- Indexes for the new filterable columns ----------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_intake_source ON leads(intake_source);
CREATE INDEX IF NOT EXISTS idx_leads_flow ON leads(flow);
CREATE INDEX IF NOT EXISTS idx_leads_submitted_at ON leads(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

-- ----------------------------------------------------------------------------
-- Attachments uploaded with the wizard submission (medical records, scans).
-- Stored as BYTEA so each lead row owns its own files atomically.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    content_type TEXT,
    size_bytes BIGINT NOT NULL,
    data BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_attachments_lead ON lead_attachments(lead_id);
