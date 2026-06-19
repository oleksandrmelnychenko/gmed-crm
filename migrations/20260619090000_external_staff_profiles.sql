CREATE TABLE IF NOT EXISTS interpreter_standalone_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    email TEXT,
    role TEXT NOT NULL DEFAULT 'standalone_staff'
        CHECK (role IN ('standalone_staff')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(profile) = 'object'),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreter_standalone_profiles_status
    ON interpreter_standalone_profiles ((profile->>'status'));

CREATE INDEX IF NOT EXISTS idx_interpreter_standalone_profiles_contract_type
    ON interpreter_standalone_profiles ((profile->>'contractType'));

DROP TRIGGER IF EXISTS set_updated_at_interpreter_standalone_profiles
    ON interpreter_standalone_profiles;
CREATE TRIGGER set_updated_at_interpreter_standalone_profiles
BEFORE UPDATE ON interpreter_standalone_profiles
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS interpreter_standalone_languages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    standalone_profile_id UUID NOT NULL REFERENCES interpreter_standalone_profiles(id) ON DELETE CASCADE,
    language_code TEXT NOT NULL,
    language_label TEXT,
    proficiency TEXT NOT NULL DEFAULT 'working'
        CHECK (proficiency IN ('native', 'fluent', 'working', 'basic', 'unknown')),
    cefr_level TEXT,
    specialization TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (standalone_profile_id, language_code)
);

CREATE INDEX IF NOT EXISTS idx_interpreter_standalone_languages_profile
    ON interpreter_standalone_languages(standalone_profile_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_interpreter_standalone_languages
    ON interpreter_standalone_languages;
CREATE TRIGGER set_updated_at_interpreter_standalone_languages
BEFORE UPDATE ON interpreter_standalone_languages
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS interpreter_standalone_profile_documents (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    standalone_profile_id UUID NOT NULL REFERENCES interpreter_standalone_profiles(id) ON DELETE CASCADE,
    document_kind TEXT NOT NULL
        CHECK (document_kind IN ('credential', 'confidentiality', 'avv', 'gdpr_training', 'work_permit', 'other')),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreter_standalone_profile_documents_profile
    ON interpreter_standalone_profile_documents(standalone_profile_id, document_kind, created_at DESC);
