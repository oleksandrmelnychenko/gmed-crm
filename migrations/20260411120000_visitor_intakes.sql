-- Visitor facade intake: raw submissions from the public wizard site.
-- Kept separate from the operational `leads` table. Review workflow can
-- promote an intake into a lead/patient later.

CREATE TABLE visitor_intakes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Meta
    source TEXT NOT NULL DEFAULT 'visitor_facade',
    flow TEXT,
    locale TEXT,
    submitted_at TIMESTAMPTZ,

    -- Identity
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    suffix TEXT,
    date_of_birth DATE,
    legal_sex TEXT,

    -- Contact
    email TEXT,
    email_consent BOOLEAN,
    primary_phone TEXT,
    primary_phone_type TEXT,
    phones JSONB NOT NULL DEFAULT '[]'::jsonb,
    whatsapp_consent BOOLEAN,
    whatsapp_number TEXT,

    -- Address
    country TEXT,
    street_address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,

    -- Language
    primary_language TEXT,
    needs_interpreter BOOLEAN,

    -- Location / eligibility path
    location TEXT,
    location_detailed TEXT,
    wants_membership BOOLEAN,
    selected_program TEXT,
    can_travel BOOLEAN,
    has_medical_records TEXT,
    records_in_accepted_language BOOLEAN,
    has_travel_documents BOOLEAN,

    -- Health
    currently_in_treatment BOOLEAN,
    has_health_risk_for_travel BOOLEAN,

    -- Concern
    primary_concern_text TEXT,
    additional_concerns TEXT,

    -- Services & insurance
    services TEXT[] NOT NULL DEFAULT '{}',
    has_insurance BOOLEAN,
    insurance_covers_germany TEXT,

    -- Wrap up
    preferred_location TEXT,
    visit_timing TEXT,
    message TEXT,

    -- Consents
    consent_automated_contact BOOLEAN NOT NULL DEFAULT false,
    consent_healthcare BOOLEAN NOT NULL DEFAULT false,
    consent_opt_out BOOLEAN NOT NULL DEFAULT false,
    consent_privacy_practices BOOLEAN NOT NULL DEFAULT false,

    -- Raw wizard snapshot (future-proof: new wizard fields land here without migration)
    raw_payload JSONB NOT NULL,

    -- Review workflow
    processing_status TEXT NOT NULL DEFAULT 'new'
        CHECK (processing_status IN ('new', 'reviewed', 'converted', 'archived', 'spam')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    converted_lead_id UUID REFERENCES leads(id),
    internal_notes TEXT,

    -- Request forensics
    remote_ip INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_visitor_intakes_created ON visitor_intakes(created_at DESC);
CREATE INDEX idx_visitor_intakes_status ON visitor_intakes(processing_status);
CREATE INDEX idx_visitor_intakes_email ON visitor_intakes(email);
CREATE INDEX idx_visitor_intakes_last_name ON visitor_intakes(last_name);
CREATE INDEX idx_visitor_intakes_submitted_at ON visitor_intakes(submitted_at DESC);

CREATE TRIGGER set_updated_at_visitor_intakes
    BEFORE UPDATE ON visitor_intakes
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Attachments (medical records) uploaded with the intake.
-- Stored as BYTEA to keep each submission atomic in the database.
CREATE TABLE visitor_intake_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visitor_intake_id UUID NOT NULL REFERENCES visitor_intakes(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    content_type TEXT,
    size_bytes BIGINT NOT NULL,
    data BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_visitor_intake_attachments_intake
    ON visitor_intake_attachments(visitor_intake_id);
