CREATE TABLE IF NOT EXISTS patient_requested_work_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    source_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    work_type_id UUID NOT NULL
        REFERENCES medical_specialization_work_types(id) ON DELETE RESTRICT,
    additional_language TEXT,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'planned', 'completed', 'cancelled')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT patient_requested_work_types_language_not_blank
        CHECK (additional_language IS NULL OR btrim(additional_language) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_requested_work_types_lead
    ON patient_requested_work_types(patient_id, source_lead_id, work_type_id)
    WHERE source_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_requested_work_types_patient
    ON patient_requested_work_types(patient_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_requested_work_types_case
    ON patient_requested_work_types(case_id)
    WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_requested_work_types_order
    ON patient_requested_work_types(order_id)
    WHERE order_id IS NOT NULL;

CREATE TRIGGER set_updated_at_patient_requested_work_types
    BEFORE UPDATE ON patient_requested_work_types
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
