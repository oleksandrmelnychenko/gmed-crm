CREATE TABLE patient_card_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    entry_date TIMESTAMPTZ NOT NULL,
    category TEXT NOT NULL CHECK (
        category IN (
            'medical_update',
            'patient_report',
            'provider_report',
            'treatment_note',
            'followup_note',
            'warning',
            'other'
        )
    ),
    source TEXT,
    content TEXT NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_card_entries_patient_date
    ON patient_card_entries(patient_id, entry_date DESC, created_at DESC);

CREATE TRIGGER set_updated_at_patient_card_entries
    BEFORE UPDATE ON patient_card_entries
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
