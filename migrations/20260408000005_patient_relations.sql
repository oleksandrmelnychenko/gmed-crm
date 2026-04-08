CREATE TABLE patient_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    related_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    related_name TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN (
        'spouse', 'parent', 'child', 'sibling', 'relative', 'guardian', 'other'
    )),
    is_emergency_contact BOOLEAN NOT NULL DEFAULT false,
    phone TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pr_patient ON patient_relations(patient_id);
