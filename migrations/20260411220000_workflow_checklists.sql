CREATE TABLE workflow_checklist_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('patient', 'order')),
    scope_id UUID NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    checklist_key TEXT NOT NULL,
    item_key TEXT NOT NULL,
    item_text TEXT NOT NULL,
    owner_role TEXT NOT NULL,
    owner_user_id UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    due_date TIMESTAMPTZ,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    sort_order INT NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scope_type, scope_id, checklist_key, item_key),
    CHECK (
        (scope_type = 'patient' AND scope_id = patient_id AND order_id IS NULL)
        OR
        (scope_type = 'order' AND order_id IS NOT NULL AND scope_id = order_id)
    )
);

CREATE INDEX idx_workflow_checklist_patient
    ON workflow_checklist_items(patient_id, scope_type, checklist_key, sort_order);
CREATE INDEX idx_workflow_checklist_order
    ON workflow_checklist_items(order_id, checklist_key, sort_order)
    WHERE order_id IS NOT NULL;
CREATE INDEX idx_workflow_checklist_owner_open
    ON workflow_checklist_items(owner_user_id, due_date)
    WHERE is_completed = false;
CREATE INDEX idx_workflow_checklist_task
    ON workflow_checklist_items(linked_task_id)
    WHERE linked_task_id IS NOT NULL;

CREATE TRIGGER set_updated_at_workflow_checklist_items
    BEFORE UPDATE ON workflow_checklist_items
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
