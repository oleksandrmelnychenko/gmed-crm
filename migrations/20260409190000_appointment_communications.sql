CREATE TABLE IF NOT EXISTS appointment_communications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('clinic', 'doctor', 'service_provider')),
    direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    channel TEXT NOT NULL CHECK (channel IN ('phone', 'email', 'portal', 'fax', 'whatsapp', 'other')),
    status TEXT NOT NULL CHECK (status IN ('planned', 'sent', 'answered', 'closed', 'cancelled')),
    subject TEXT NOT NULL,
    message TEXT,
    contact_name TEXT,
    due_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_communications_appointment
    ON appointment_communications(appointment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointment_communications_patient
    ON appointment_communications(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointment_communications_provider
    ON appointment_communications(provider_id, created_at DESC);
