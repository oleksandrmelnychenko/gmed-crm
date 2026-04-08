-- Initial schema: users, audit_log, consent_records, reference data

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Users
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN (
        'ceo', 'ceo_assistant', 'patient_manager',
        'teamlead_interpreter', 'interpreter', 'concierge',
        'billing', 'sales', 'it_admin', 'patient'
    )),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- Audit Log (append-only, immutable)
-- ============================================
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    old_value JSONB,
    new_value JSONB,
    context JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_action ON audit_log(action);

-- Prevent updates/deletes on audit_log (immutability)
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is immutable — updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_mutation();

-- ============================================
-- Consent Records (DSGVO)
-- ============================================
CREATE TABLE consent_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    consent_type TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    granted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    context JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_user ON consent_records(user_id);

-- ============================================
-- Reference Data
-- ============================================
CREATE TABLE ref_countries (
    code TEXT PRIMARY KEY,
    name_de TEXT NOT NULL,
    name_en TEXT NOT NULL
);

CREATE TABLE ref_languages (
    code TEXT PRIMARY KEY,
    name_de TEXT NOT NULL,
    name_en TEXT NOT NULL
);

CREATE TABLE ref_document_categories (
    id TEXT PRIMARY KEY,
    name_de TEXT NOT NULL,
    name_en TEXT NOT NULL,
    is_medical BOOLEAN NOT NULL DEFAULT false
);

-- ============================================
-- Updated_at trigger (reusable)
-- ============================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================
-- Seed: default admin (dev only, bcrypt via pgcrypto)
-- In production: create via CLI tool with Argon2id hash
-- ============================================
INSERT INTO users (email, password_hash, name, role) VALUES (
    'admin@gmed.de',
    crypt('admin123', gen_salt('bf')),
    'System Admin',
    'ceo'
);
