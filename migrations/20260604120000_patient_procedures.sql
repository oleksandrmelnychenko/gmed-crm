-- Patient-level therapies / procedures (the Arztbrief "Therapie" rows), e.g.
-- "31.07.16 Appendektomie ... (5-470.10)" with an OPS procedure code. Mirrors the
-- per-case operationen table but hangs off the patient and carries an OPS code,
-- with the same provider + doctor attribution as the other clinical sections.

CREATE TABLE patient_procedures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    ops_code TEXT,
    performed_on TEXT,
    note TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_procedures_patient ON patient_procedures (patient_id);
