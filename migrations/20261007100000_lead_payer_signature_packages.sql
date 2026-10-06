-- Lead cabinet, the payer's signature package (owner decisions 2026-10-06,
-- phase 3b): a third-party payer signs one package of four documents with a
-- qualified electronic signature (Skribble) once it has sent its own answers —
-- the self-disclosure, the Kostenübernahmeerklärung, the patient's statement
-- about the payer and the payer's copy of the cost estimate. The QES also
-- identifies the payer under the GwG. See
-- docs/architecture/lead-payer-declaration_ua.md («Пакет підписів платника
-- (фаза 3b)») and document-signatures-germany_ua.md.

-- The patient's own consent that GMED passes the cost estimate (service types
-- and amounts only, without diagnoses or treatment names) on to the payer
-- named (owner decision 2026-10-06 on open question 1). Like the consent to
-- contact the payer: only the lead gives or removes it, it belongs to the
-- payer named and goes with another payer; staff read it.
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS cost_estimate_consent_at TIMESTAMPTZ;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_cost_estimate_consent_check;

ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_cost_estimate_consent_check CHECK (
        cost_estimate_consent_at IS NULL OR payer_kind = 'third_party'
    );

-- One prepared package per lead (the non-superseded row): what it was built
-- from, so a later change makes it outdated, the four documents in slot
-- order, and the signature request once staff sent it. Nothing is withdrawn
-- automatically; staff withdraw the request and prepare again. No backfill.
CREATE TABLE IF NOT EXISTS lead_payer_signature_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    -- `link`: the payer's own link; `cabinet`: a paying parent with a login.
    mode TEXT NOT NULL CHECK (mode IN ('link', 'cabinet')),
    -- The signer: the payer, a paying parent or the legal representative of
    -- an organisation (`acting_for` = the organisation); the e-mail is the
    -- confirmed address of the payer's statement.
    signer_first_name TEXT NOT NULL CHECK (char_length(signer_first_name) <= 120),
    signer_last_name TEXT NOT NULL CHECK (char_length(signer_last_name) <= 120),
    signer_email TEXT NOT NULL CHECK (char_length(signer_email) <= 254),
    acting_for TEXT CHECK (acting_for IS NULL OR char_length(acting_for) <= 200),
    -- What the documents were made from.
    statement_submitted_at TIMESTAMPTZ NOT NULL,
    payer_identity_changed_at TIMESTAMPTZ NOT NULL,
    patient_statement_fingerprint TEXT NOT NULL CHECK (
        patient_statement_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    -- The client's Kostenvoranschlag (version) the payer's copy was made from.
    cost_estimate_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    self_disclosure_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    cost_coverage_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    patient_statement_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    payer_cost_estimate_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    prepared_by UUID NOT NULL REFERENCES users(id),
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at TIMESTAMPTZ,
    request_id UUID REFERENCES document_signature_requests(id) ON DELETE SET NULL,
    sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_at TIMESTAMPTZ,
    language TEXT CHECK (language IS NULL OR language IN ('de', 'en', 'fr', 'it')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_payer_signature_packages_current
    ON lead_payer_signature_packages (lead_id)
    WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_payer_signature_packages_request
    ON lead_payer_signature_packages (request_id);

DROP TRIGGER IF EXISTS set_updated_at_lead_payer_signature_packages
    ON lead_payer_signature_packages;
CREATE TRIGGER set_updated_at_lead_payer_signature_packages
    BEFORE UPDATE ON lead_payer_signature_packages
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
