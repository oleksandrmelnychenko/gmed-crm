CREATE TABLE IF NOT EXISTS interpreter_patient_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    interpreter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference TEXT NOT NULL DEFAULT 'neutral'
        CHECK (preference IN ('preferred', 'neutral', 'avoid')),
    note TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (patient_id, interpreter_id)
);

CREATE INDEX IF NOT EXISTS idx_interpreter_patient_preferences_interpreter
    ON interpreter_patient_preferences(interpreter_id, preference);

CREATE INDEX IF NOT EXISTS idx_interpreter_patient_preferences_patient
    ON interpreter_patient_preferences(patient_id, preference);

CREATE TRIGGER set_updated_at_interpreter_patient_preferences
    BEFORE UPDATE ON interpreter_patient_preferences
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS interpreter_languages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interpreter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language_code TEXT NOT NULL,
    language_label TEXT,
    proficiency TEXT NOT NULL DEFAULT 'working'
        CHECK (proficiency IN ('native', 'fluent', 'working', 'basic', 'unknown')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (interpreter_id, language_code)
);

CREATE INDEX IF NOT EXISTS idx_interpreter_languages_interpreter
    ON interpreter_languages(interpreter_id)
    WHERE is_active = true;

CREATE TRIGGER set_updated_at_interpreter_languages
    BEFORE UPDATE ON interpreter_languages
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
