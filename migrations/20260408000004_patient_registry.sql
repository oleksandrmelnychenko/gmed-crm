CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id TEXT NOT NULL UNIQUE,
    title TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    birth_date DATE NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'diverse')),
    nationality TEXT,
    residence_country TEXT,
    languages TEXT[] NOT NULL DEFAULT '{}',

    phone_primary TEXT,
    phone_secondary TEXT,
    email TEXT,
    address_street TEXT,
    address_city TEXT,
    address_zip TEXT,
    address_country TEXT,

    insurance_provider TEXT,
    insurance_number TEXT,
    insurance_type TEXT CHECK (insurance_type IS NULL OR insurance_type IN ('private', 'public', 'self_pay', 'foreign')),

    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    emergency_contact_relation TEXT,

    legal_status JSONB NOT NULL DEFAULT '{}',
    notes TEXT,

    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patients_patient_id ON patients(patient_id);
CREATE INDEX idx_patients_name ON patients(last_name, first_name);
CREATE INDEX idx_patients_active ON patients(is_active) WHERE is_active;

CREATE TRIGGER set_updated_at_patients
    BEFORE UPDATE ON patients
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE patient_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    UNIQUE(patient_id, user_id)
);

CREATE INDEX idx_pa_patient ON patient_assignments(patient_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_pa_user ON patient_assignments(user_id) WHERE revoked_at IS NULL;

CREATE SEQUENCE patient_id_seq START 1;
