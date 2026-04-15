CREATE TABLE patient_medical_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    order_date TIMESTAMPTZ NOT NULL,
    order_type TEXT NOT NULL CHECK (
        order_type IN (
            'physiotherapy',
            'diet',
            'lab_recheck',
            'imaging',
            'medication_followup',
            'procedure',
            'other'
        )
    ),
    title TEXT NOT NULL,
    instructions TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    due_date DATE,
    source TEXT,
    ordered_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_medical_orders_patient_date
    ON patient_medical_orders(patient_id, order_date DESC, created_at DESC);

CREATE INDEX idx_patient_medical_orders_status
    ON patient_medical_orders(status, due_date);

CREATE TRIGGER set_updated_at_patient_medical_orders
    BEFORE UPDATE ON patient_medical_orders
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
