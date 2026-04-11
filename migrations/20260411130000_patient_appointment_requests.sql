CREATE TABLE IF NOT EXISTS patient_appointment_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    appointment_type TEXT NOT NULL CHECK (appointment_type IN ('medical', 'non_medical')),
    preferred_date_from DATE,
    preferred_date_to DATE,
    preferred_time_of_day TEXT CHECK (
        preferred_time_of_day IS NULL
        OR preferred_time_of_day IN ('morning', 'midday', 'afternoon', 'evening', 'flexible')
    ),
    requested_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    requested_doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    specialty TEXT,
    location TEXT,
    reason TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (
        status IN ('requested', 'approved', 'rejected', 'converted', 'cancelled')
    ),
    review_note TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    converted_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_patient
    ON patient_appointment_requests(patient_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_status
    ON patient_appointment_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_requester
    ON patient_appointment_requests(requested_by, requested_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_patient_appointment_requests ON patient_appointment_requests;
CREATE TRIGGER set_updated_at_patient_appointment_requests
    BEFORE UPDATE ON patient_appointment_requests
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
