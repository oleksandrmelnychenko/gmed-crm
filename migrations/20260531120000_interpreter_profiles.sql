CREATE TABLE IF NOT EXISTS interpreter_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(profile) = 'object'),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreter_profiles_profile_gin
    ON interpreter_profiles USING GIN (profile);

CREATE INDEX IF NOT EXISTS idx_interpreter_profiles_status
    ON interpreter_profiles ((profile->>'status'));

CREATE INDEX IF NOT EXISTS idx_interpreter_profiles_contract_type
    ON interpreter_profiles ((profile->>'contractType'));

CREATE TRIGGER set_updated_at_interpreter_profiles
    BEFORE UPDATE ON interpreter_profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
