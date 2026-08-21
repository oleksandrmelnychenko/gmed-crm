-- Dedicated, non-clinical task/event scope for the Concierge workspace.
-- The existing tasks table remains the source of truth, while the scope
-- constraint prevents operational items from carrying patient/order payloads.

ALTER TABLE tasks
    ADD COLUMN task_scope TEXT NOT NULL DEFAULT 'general',
    ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'task',
    ADD COLUMN concierge_service_id UUID REFERENCES concierge_services(id) ON DELETE SET NULL,
    ADD COLUMN starts_at TIMESTAMPTZ,
    ADD COLUMN ends_at TIMESTAMPTZ,
    ADD COLUMN location TEXT;

ALTER TABLE tasks
    ADD CONSTRAINT tasks_scope_check
        CHECK (task_scope IN ('general', 'concierge_operational')),
    ADD CONSTRAINT tasks_kind_check
        CHECK (task_kind IN ('task', 'event')),
    ADD CONSTRAINT tasks_concierge_operational_no_clinical_context_check
        CHECK (
            task_scope <> 'concierge_operational'
            OR (patient_id IS NULL AND order_id IS NULL AND appointment_id IS NULL)
        ),
    ADD CONSTRAINT tasks_event_schedule_check
        CHECK (task_kind <> 'event' OR starts_at IS NOT NULL),
    ADD CONSTRAINT tasks_concierge_operational_schedule_shape_check
        CHECK (
            task_scope <> 'concierge_operational'
            OR (task_kind = 'task' AND starts_at IS NULL AND ends_at IS NULL)
            OR (task_kind = 'event' AND due_date IS NULL)
        ),
    ADD CONSTRAINT tasks_schedule_order_check
        CHECK (ends_at IS NULL OR (starts_at IS NOT NULL AND ends_at > starts_at));

CREATE INDEX idx_tasks_concierge_operational_assignee
    ON tasks (assigned_to, status, (COALESCE(starts_at, due_date)), created_at DESC)
    WHERE task_scope = 'concierge_operational';

CREATE INDEX idx_tasks_concierge_operational_service
    ON tasks (concierge_service_id)
    WHERE task_scope = 'concierge_operational' AND concierge_service_id IS NOT NULL;
