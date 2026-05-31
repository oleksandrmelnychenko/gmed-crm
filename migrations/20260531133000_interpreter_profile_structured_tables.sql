CREATE TABLE IF NOT EXISTS interpreter_profile_details (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    gender TEXT,
    birth_date DATE,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'vacation', 'sick', 'training', 'blocked', 'terminated')),
    contract_type TEXT
        CHECK (contract_type IS NULL OR contract_type IN ('employee', 'freelancer', 'hourly')),
    contract_start_date DATE,
    contract_end_date DATE,
    employment_kind TEXT
        CHECK (employment_kind IS NULL OR employment_kind IN ('internal', 'external')),
    phone TEXT,
    email_secure BOOLEAN NOT NULL DEFAULT false,
    address TEXT,
    emergency_contact TEXT,
    medical_knowledge TEXT,
    training_history TEXT,
    work_permit_valid_until DATE,
    internal_notes TEXT,
    retention_delete_at DATE,
    erasure_request_status TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreter_profile_details_status
    ON interpreter_profile_details(status);

CREATE INDEX IF NOT EXISTS idx_interpreter_profile_details_contract_type
    ON interpreter_profile_details(contract_type);

CREATE TRIGGER set_updated_at_interpreter_profile_details
    BEFORE UPDATE ON interpreter_profile_details
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS interpreter_work_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interpreter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zone_type TEXT NOT NULL CHECK (zone_type IN ('country', 'location')),
    value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (interpreter_id, zone_type, value)
);

CREATE INDEX IF NOT EXISTS idx_interpreter_work_zones_lookup
    ON interpreter_work_zones(zone_type, value);

CREATE TABLE IF NOT EXISTS interpreter_compliance_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    confidentiality_status TEXT
        CHECK (confidentiality_status IS NULL OR confidentiality_status IN ('signed', 'missing')),
    confidentiality_signed_at DATE,
    confidentiality_document_url TEXT,
    avv_status TEXT
        CHECK (avv_status IS NULL OR avv_status IN ('signed', 'pending')),
    avv_signed_at DATE,
    avv_document_url TEXT,
    gdpr_training_at DATE,
    work_permit_valid_until DATE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_interpreter_compliance_profiles
    BEFORE UPDATE ON interpreter_compliance_profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS interpreter_finance_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hourly_rate NUMERIC(10, 2),
    salary_class TEXT,
    bank_details TEXT,
    tax_number TEXT,
    ust_idnr TEXT,
    billing_status TEXT
        CHECK (billing_status IS NULL OR billing_status IN ('unpaid', 'paid', 'overdue')),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreter_finance_profiles_billing_status
    ON interpreter_finance_profiles(billing_status);

CREATE TRIGGER set_updated_at_interpreter_finance_profiles
    BEFORE UPDATE ON interpreter_finance_profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS interpreter_access_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_level TEXT
        CHECK (access_level IS NULL OR access_level IN ('appointment_only', 'medical_shared', 'full')),
    auto_block_policy TEXT
        CHECK (auto_block_policy IS NULL OR auto_block_policy IN ('immediate', 'after_one_hour')),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_interpreter_access_profiles
    BEFORE UPDATE ON interpreter_access_profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS interpreter_equipment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interpreter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (interpreter_id, label)
);

CREATE TABLE IF NOT EXISTS interpreter_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interpreter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_type TEXT NOT NULL DEFAULT 'certificate'
        CHECK (credential_type IN ('sworn_interpreter', 'medical_translation', 'certificate', 'training')),
    title TEXT NOT NULL,
    issuer TEXT,
    issued_at DATE,
    expires_at DATE,
    document_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreter_credentials_interpreter
    ON interpreter_credentials(interpreter_id, credential_type);

CREATE INDEX IF NOT EXISTS idx_interpreter_credentials_expires_at
    ON interpreter_credentials(expires_at)
    WHERE expires_at IS NOT NULL;

CREATE TRIGGER set_updated_at_interpreter_credentials
    BEFORE UPDATE ON interpreter_credentials
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO interpreter_profile_details (
    user_id,
    gender,
    birth_date,
    status,
    contract_type,
    contract_start_date,
    contract_end_date,
    employment_kind,
    phone,
    email_secure,
    address,
    emergency_contact,
    medical_knowledge,
    training_history,
    work_permit_valid_until,
    internal_notes,
    retention_delete_at,
    erasure_request_status,
    updated_by
)
SELECT
    p.user_id,
    NULLIF(p.profile->>'gender', ''),
    CASE WHEN p.profile->>'birthDate' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.profile->>'birthDate')::date END,
    CASE
        WHEN p.profile->>'status' IN ('active', 'vacation', 'sick', 'training', 'blocked', 'terminated')
        THEN p.profile->>'status'
        ELSE 'active'
    END,
    CASE
        WHEN p.profile->>'contractType' IN ('employee', 'freelancer', 'hourly')
        THEN p.profile->>'contractType'
    END,
    CASE WHEN p.profile->>'contractStartDate' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.profile->>'contractStartDate')::date END,
    CASE WHEN p.profile->>'contractEndDate' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.profile->>'contractEndDate')::date END,
    CASE
        WHEN p.profile->>'employmentKind' IN ('internal', 'external')
        THEN p.profile->>'employmentKind'
    END,
    COALESCE(NULLIF(p.profile->>'phone', ''), NULLIF(p.profile#>>'{contact,phone}', '')),
    COALESCE(
        CASE WHEN lower(p.profile->>'emailSecure') IN ('true', 'false') THEN (p.profile->>'emailSecure')::boolean END,
        CASE WHEN lower(p.profile#>>'{contact,emailSecure}') IN ('true', 'false') THEN (p.profile#>>'{contact,emailSecure}')::boolean END,
        false
    ),
    COALESCE(NULLIF(p.profile->>'address', ''), NULLIF(p.profile#>>'{contact,address}', '')),
    COALESCE(NULLIF(p.profile->>'emergencyContact', ''), NULLIF(p.profile#>>'{contact,emergencyContact}', '')),
    NULLIF(p.profile->>'medicalKnowledge', ''),
    NULLIF(p.profile->>'trainingHistory', ''),
    CASE WHEN p.profile->>'workPermitValidUntil' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.profile->>'workPermitValidUntil')::date END,
    NULLIF(p.profile->>'internalNotes', ''),
    CASE WHEN p.profile->>'retentionDeleteAt' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.profile->>'retentionDeleteAt')::date END,
    NULLIF(p.profile->>'erasureRequestStatus', ''),
    p.updated_by
FROM interpreter_profiles p
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO interpreter_compliance_profiles (
    user_id,
    confidentiality_status,
    confidentiality_signed_at,
    confidentiality_document_url,
    avv_status,
    avv_signed_at,
    avv_document_url,
    gdpr_training_at,
    work_permit_valid_until,
    updated_by
)
SELECT
    p.user_id,
    CASE
        WHEN COALESCE(p.profile->>'confidentialityStatus', p.profile#>>'{compliance,confidentialityStatus}') IN ('signed', 'missing')
        THEN COALESCE(p.profile->>'confidentialityStatus', p.profile#>>'{compliance,confidentialityStatus}')
    END,
    CASE
        WHEN COALESCE(p.profile->>'confidentialitySignedAt', p.profile#>>'{compliance,confidentialitySignedAt}') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN COALESCE(p.profile->>'confidentialitySignedAt', p.profile#>>'{compliance,confidentialitySignedAt}')::date
    END,
    COALESCE(NULLIF(p.profile->>'confidentialityDocumentUrl', ''), NULLIF(p.profile#>>'{compliance,confidentialityDocumentUrl}', '')),
    CASE
        WHEN COALESCE(p.profile->>'avvStatus', p.profile#>>'{compliance,avvStatus}') IN ('signed', 'pending')
        THEN COALESCE(p.profile->>'avvStatus', p.profile#>>'{compliance,avvStatus}')
    END,
    CASE
        WHEN COALESCE(p.profile->>'avvSignedAt', p.profile#>>'{compliance,avvSignedAt}') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN COALESCE(p.profile->>'avvSignedAt', p.profile#>>'{compliance,avvSignedAt}')::date
    END,
    COALESCE(NULLIF(p.profile->>'avvDocumentUrl', ''), NULLIF(p.profile#>>'{compliance,avvDocumentUrl}', '')),
    CASE
        WHEN COALESCE(p.profile->>'gdprTrainingAt', p.profile#>>'{compliance,gdprTrainingAt}') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN COALESCE(p.profile->>'gdprTrainingAt', p.profile#>>'{compliance,gdprTrainingAt}')::date
    END,
    CASE WHEN p.profile->>'workPermitValidUntil' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.profile->>'workPermitValidUntil')::date END,
    p.updated_by
FROM interpreter_profiles p
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO interpreter_finance_profiles (
    user_id,
    hourly_rate,
    salary_class,
    bank_details,
    tax_number,
    ust_idnr,
    billing_status,
    updated_by
)
SELECT
    p.user_id,
    CASE
        WHEN COALESCE(p.profile->>'hourlyRate', p.profile#>>'{finance,hourlyRate}') ~ '^\d+(\.\d{1,2})?$'
        THEN COALESCE(p.profile->>'hourlyRate', p.profile#>>'{finance,hourlyRate}')::numeric(10, 2)
    END,
    COALESCE(NULLIF(p.profile->>'salaryClass', ''), NULLIF(p.profile#>>'{finance,salaryClass}', '')),
    COALESCE(NULLIF(p.profile->>'bankDetails', ''), NULLIF(p.profile#>>'{finance,bankDetails}', '')),
    COALESCE(NULLIF(p.profile->>'taxNumber', ''), NULLIF(p.profile#>>'{finance,taxNumber}', '')),
    COALESCE(NULLIF(p.profile->>'ustIdnr', ''), NULLIF(p.profile#>>'{finance,ustIdnr}', '')),
    CASE
        WHEN COALESCE(p.profile->>'billingStatus', p.profile#>>'{finance,billingStatus}') IN ('unpaid', 'paid', 'overdue')
        THEN COALESCE(p.profile->>'billingStatus', p.profile#>>'{finance,billingStatus}')
    END,
    p.updated_by
FROM interpreter_profiles p
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO interpreter_access_profiles (
    user_id,
    access_level,
    auto_block_policy,
    updated_by
)
SELECT
    p.user_id,
    CASE
        WHEN COALESCE(p.profile->>'accessLevel', p.profile#>>'{access,level}') IN ('appointment_only', 'medical_shared', 'full')
        THEN COALESCE(p.profile->>'accessLevel', p.profile#>>'{access,level}')
    END,
    CASE
        WHEN COALESCE(p.profile->>'autoBlockPolicy', p.profile#>>'{access,autoBlockPolicy}') IN ('immediate', 'after_one_hour')
        THEN COALESCE(p.profile->>'autoBlockPolicy', p.profile#>>'{access,autoBlockPolicy}')
    END,
    p.updated_by
FROM interpreter_profiles p
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO interpreter_work_zones (interpreter_id, zone_type, value, sort_order)
SELECT p.user_id, 'country', value, ordinality::integer - 1
FROM interpreter_profiles p,
     jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p.profile->'workCountries') = 'array'
             THEN p.profile->'workCountries'
             ELSE '[]'::jsonb
        END
     ) WITH ORDINALITY AS countries(value, ordinality)
WHERE value <> ''
ON CONFLICT (interpreter_id, zone_type, value) DO NOTHING;

INSERT INTO interpreter_work_zones (interpreter_id, zone_type, value, sort_order)
SELECT p.user_id, 'location', value, ordinality::integer - 1
FROM interpreter_profiles p,
     jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p.profile->'workLocations') = 'array'
             THEN p.profile->'workLocations'
             ELSE '[]'::jsonb
        END
     ) WITH ORDINALITY AS locations(value, ordinality)
WHERE value <> ''
ON CONFLICT (interpreter_id, zone_type, value) DO NOTHING;

INSERT INTO interpreter_equipment (interpreter_id, label, sort_order)
SELECT p.user_id, value, ordinality::integer - 1
FROM interpreter_profiles p,
     jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p.profile->'equipment') = 'array'
             THEN p.profile->'equipment'
             ELSE '[]'::jsonb
        END
     ) WITH ORDINALITY AS equipment(value, ordinality)
WHERE value <> ''
ON CONFLICT (interpreter_id, label) DO NOTHING;
