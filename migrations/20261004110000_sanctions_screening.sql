-- In-house screening against the EU consolidated financial sanctions list and
-- the blocked-country policy (owner decisions 2026-10-03).
-- See docs/architecture/sanctions-screening_ua.md.

-- One row per imported list file. Exactly one version is active; a failed
-- download never replaces it. Entries of old versions are pruned, the version
-- rows stay because hits refer to them.
CREATE TABLE IF NOT EXISTS sanctions_list_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL CHECK (source IN ('download', 'upload')),
    generated_at TIMESTAMPTZ,
    list_date DATE NOT NULL,
    global_file_id TEXT,
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    entry_count INTEGER NOT NULL CHECK (entry_count > 0),
    person_count INTEGER NOT NULL CHECK (person_count >= 0),
    is_active BOOLEAN NOT NULL DEFAULT false,
    entries_pruned_at TIMESTAMPTZ,
    imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sanctions_list_versions_one_active
    ON sanctions_list_versions ((true))
    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_sanctions_list_versions_created
    ON sanctions_list_versions (created_at DESC);

-- Listed persons and entities of a version (public data of the EU list).
CREATE TABLE IF NOT EXISTS sanctions_list_entries (
    version_id UUID NOT NULL REFERENCES sanctions_list_versions(id) ON DELETE CASCADE,
    logical_id TEXT NOT NULL,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('person', 'entity')),
    eu_reference TEXT,
    data JSONB NOT NULL,
    PRIMARY KEY (version_id, logical_id)
);

-- Download bookkeeping (one row).
CREATE TABLE IF NOT EXISTS sanctions_list_sync_state (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_at TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sanctions_list_sync_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Possible matches. A hit belongs to a lead (its patient, a guardian of a
-- minor, the third-party payer) or to a patient, and follows that record's
-- retention. Open and confirmed hits block; only a false-positive decision
-- taken while the hit is open unblocks. Decisions are final.
CREATE TABLE IF NOT EXISTS sanctions_hits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_kind TEXT NOT NULL
        CHECK (subject_kind IN ('lead_patient', 'lead_guardian', 'lead_payer', 'patient')),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    subject_ref TEXT NOT NULL DEFAULT '',
    subject_snapshot JSONB NOT NULL,
    subject_fingerprint TEXT NOT NULL,
    list_version_id UUID NOT NULL REFERENCES sanctions_list_versions(id),
    list_logical_id TEXT NOT NULL,
    list_entry JSONB NOT NULL,
    entry_fingerprint TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL CHECK (score >= 0 AND score <= 1),
    match_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'false_positive', 'confirmed')),
    still_matches BOOLEAN NOT NULL DEFAULT true,
    last_screened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    decision_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sanctions_hits_owner_check CHECK (
        (subject_kind = 'patient' AND patient_id IS NOT NULL AND lead_id IS NULL)
        OR (subject_kind <> 'patient' AND lead_id IS NOT NULL AND patient_id IS NULL)
    ),
    CONSTRAINT sanctions_hits_decision_check CHECK (
        (status = 'open' AND decided_at IS NULL AND decided_by IS NULL AND decision_reason IS NULL)
        OR (
            status <> 'open'
            AND decided_at IS NOT NULL
            AND decided_by IS NOT NULL
            AND char_length(btrim(decision_reason)) >= 10
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sanctions_hits_one_open_per_subject_entry
    ON sanctions_hits (
        subject_kind,
        COALESCE(lead_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(patient_id, '00000000-0000-0000-0000-000000000000'::uuid),
        subject_ref,
        list_logical_id
    )
    WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_sanctions_hits_lead ON sanctions_hits (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sanctions_hits_patient ON sanctions_hits (patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sanctions_hits_status ON sanctions_hits (status, created_at DESC);

-- A decision is final: once a hit is false_positive or confirmed, its status
-- and decision fields never change again (re-screening may only refresh
-- still_matches / last_screened_at).
CREATE OR REPLACE FUNCTION sanctions_hits_decision_is_final() RETURNS trigger AS $$
BEGIN
    IF OLD.status <> 'open' AND (
        NEW.status IS DISTINCT FROM OLD.status
        OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
        OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
        OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
        OR NEW.subject_snapshot IS DISTINCT FROM OLD.subject_snapshot
        OR NEW.list_entry IS DISTINCT FROM OLD.list_entry
    ) THEN
        RAISE EXCEPTION 'sanctions hit % is decided (%); the decision is final', OLD.id, OLD.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_hits_decision_is_final ON sanctions_hits;
CREATE TRIGGER trg_sanctions_hits_decision_is_final
    BEFORE UPDATE ON sanctions_hits
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_hits_decision_is_final();

-- The CEO's lift of the country block for one lead (or one patient without a
-- lead). Revoked lifts stay as history.
CREATE TABLE IF NOT EXISTS sanctions_country_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    countries TEXT[] NOT NULL CHECK (cardinality(countries) > 0),
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 10),
    lifted_by UUID NOT NULL REFERENCES users(id),
    lifted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by UUID REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT,
    CONSTRAINT sanctions_country_overrides_owner_check CHECK (num_nonnulls(lead_id, patient_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sanctions_country_overrides_one_active
    ON sanctions_country_overrides (
        COALESCE(lead_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(patient_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE revoked_at IS NULL;

-- Leads and patients whose screened data changed; the server screens them
-- within seconds. Triggers catch every writer (wizard, public intake, patient
-- portal, imports).
CREATE TABLE IF NOT EXISTS sanctions_screening_queue (
    subject_type TEXT NOT NULL CHECK (subject_type IN ('lead', 'patient')),
    subject_id UUID NOT NULL,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_type, subject_id)
);

CREATE OR REPLACE FUNCTION sanctions_enqueue(kind TEXT, subject UUID) RETURNS void AS $$
BEGIN
    INSERT INTO sanctions_screening_queue (subject_type, subject_id)
    VALUES (kind, subject)
    ON CONFLICT (subject_type, subject_id) DO UPDATE SET queued_at = now();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sanctions_enqueue_lead() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT'
        OR NEW.first_name IS DISTINCT FROM OLD.first_name
        OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
        OR NEW.last_name IS DISTINCT FROM OLD.last_name
        OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
        OR NEW.citizenships IS DISTINCT FROM OLD.citizenships
        OR NEW.country IS DISTINCT FROM OLD.country
        OR NEW.trusted_contacts IS DISTINCT FROM OLD.trusted_contacts
        OR (NEW.wizard_state ->> 'registration_country')
            IS DISTINCT FROM (OLD.wizard_state ->> 'registration_country')
    THEN
        PERFORM sanctions_enqueue('lead', NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_lead ON leads;
CREATE TRIGGER trg_sanctions_enqueue_lead
    AFTER INSERT OR UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_lead();

CREATE OR REPLACE FUNCTION sanctions_enqueue_patient() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT'
        OR NEW.first_name IS DISTINCT FROM OLD.first_name
        OR NEW.last_name IS DISTINCT FROM OLD.last_name
        OR NEW.birth_date IS DISTINCT FROM OLD.birth_date
        OR NEW.citizenships IS DISTINCT FROM OLD.citizenships
        OR NEW.nationality IS DISTINCT FROM OLD.nationality
        OR NEW.residence_country IS DISTINCT FROM OLD.residence_country
        OR NEW.address_country IS DISTINCT FROM OLD.address_country
        OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
    THEN
        PERFORM sanctions_enqueue('patient', NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_patient ON patients;
CREATE TRIGGER trg_sanctions_enqueue_patient
    AFTER INSERT OR UPDATE ON patients
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_patient();

-- Payer declarations queue their lead. The table is created by the payer
-- declaration migration; when it already exists the trigger is attached here,
-- otherwise that migration (or a follow-up) attaches this function.
CREATE OR REPLACE FUNCTION sanctions_enqueue_lead_of_payer() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sanctions_enqueue('lead', OLD.lead_id);
        RETURN OLD;
    END IF;
    PERFORM sanctions_enqueue('lead', NEW.lead_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF to_regclass('public.lead_payer_declarations') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_sanctions_enqueue_lead_of_payer ON lead_payer_declarations';
        EXECUTE 'CREATE TRIGGER trg_sanctions_enqueue_lead_of_payer
                 AFTER INSERT OR UPDATE OR DELETE ON lead_payer_declarations
                 FOR EACH ROW EXECUTE FUNCTION sanctions_enqueue_lead_of_payer()';
    END IF;
END;
$$;

-- Blocked-country policy: any citizenship or residence of the patient, a
-- guardian of a minor or the third-party payer in this list blocks
-- qualification, conversion and the agency countersignature until the CEO
-- lifts it for the lead. Changed by the CEO only (not via /admin/settings).
INSERT INTO system_settings (key, value, description) VALUES
    ('blocked_countries', '["RU"]'::jsonb,
     'Blocked countries (ISO 3166-1 alpha-2): citizenship or residence blocks qualification and countersignature; CEO only')
ON CONFLICT (key) DO NOTHING;
