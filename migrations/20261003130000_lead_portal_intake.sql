-- Lead portal intake (owner decisions 2026-10-03): the prospective patient
-- fills wizard step 1 (own personal data) and uploads documents in the patient
-- portal; staff continue from step 2. See docs/architecture/lead-patient-portal_ua.md.

-- "Send to the manager" and which step-1 fields the patient entered. The
-- markers hold a hash of the entered value (not the value), so the staff
-- wizard shows "from the patient" only while the field still has that value.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS portal_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS portal_submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS portal_field_updates JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Further logins that reach a lead's portal page. The lead's own login stays
-- in leads.portal_user_id (kind 'self'); a parent or legal guardian of a minor
-- gets a row of kind 'guardian' (a minor has no own login). One guardian login
-- may reach several leads (a parent with two children).
CREATE TABLE IF NOT EXISTS lead_portal_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('self', 'guardian')),
    -- The lead's trusted contact (leads.trusted_contacts[].id) the login was issued for.
    trusted_contact_id UUID,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_portal_access_active
    ON lead_portal_access (lead_id, user_id)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_portal_access_user
    ON lead_portal_access (user_id)
    WHERE revoked_at IS NULL;

-- Documents the patient (or guardian) uploaded through the portal, with the
-- Art. 9 consent they were uploaded under. The document itself is an ordinary
-- `documents` row of the lead; deleting it removes this row.
CREATE TABLE IF NOT EXISTS lead_portal_uploads (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    access_kind TEXT NOT NULL CHECK (access_kind IN ('self', 'guardian')),
    consent_record_id UUID REFERENCES consent_records(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Staff looked at the upload; from then on the patient can no longer remove it.
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The patient removed the upload before staff reviewed it.
    withdrawn_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_portal_uploads_lead
    ON lead_portal_uploads (lead_id, created_at);

-- Consent given in the portal before there is a patient record: the lead it
-- was given for. Conversion copies the patient id onto the row.
ALTER TABLE consent_records
    ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_consent_records_lead
    ON consent_records (lead_id)
    WHERE lead_id IS NOT NULL;
