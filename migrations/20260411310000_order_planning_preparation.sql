CREATE TABLE order_planning_preparation (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    treatment_plan_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (treatment_plan_status IN ('draft', 'agreed', 'correction_requested', 'finalized')),
    treatment_plan_note TEXT,
    non_medical_required BOOLEAN NOT NULL DEFAULT false,
    interpreter_required BOOLEAN NOT NULL DEFAULT false,
    preparation_documents_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (preparation_documents_status IN ('pending', 'sent', 'not_required')),
    interpreter_briefing_status TEXT NOT NULL DEFAULT 'not_needed'
        CHECK (interpreter_briefing_status IN ('not_needed', 'pending', 'completed')),
    plan_finalized_at TIMESTAMPTZ,
    plan_finalized_by UUID REFERENCES users(id),
    preparation_documents_sent_at TIMESTAMPTZ,
    preparation_documents_sent_by UUID REFERENCES users(id),
    interpreter_briefed_at TIMESTAMPTZ,
    interpreter_briefed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_order_planning_preparation
    BEFORE UPDATE ON order_planning_preparation
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
