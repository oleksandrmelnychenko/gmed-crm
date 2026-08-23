ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_concierge_operational_no_clinical_context_check;

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS task_audience TEXT NOT NULL DEFAULT 'internal',
    ADD COLUMN IF NOT EXISTS external_assignee_type TEXT,
    ADD COLUMN IF NOT EXISTS external_assignee_name TEXT,
    ADD COLUMN IF NOT EXISTS external_assignee_phone TEXT,
    ADD COLUMN IF NOT EXISTS external_assignee_email TEXT;

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_task_audience_check,
    ADD CONSTRAINT tasks_task_audience_check
        CHECK (task_audience IN ('internal', 'external')),
    DROP CONSTRAINT IF EXISTS tasks_concierge_operational_context_check,
    ADD CONSTRAINT tasks_concierge_operational_context_check
        CHECK (
            task_scope <> 'concierge_operational'
            OR (order_id IS NULL AND appointment_id IS NULL)
        ),
    DROP CONSTRAINT IF EXISTS tasks_external_assignee_check,
    ADD CONSTRAINT tasks_external_assignee_check
        CHECK (
            task_scope <> 'concierge_operational'
            OR (
                task_audience = 'internal'
                AND external_assignee_type IS NULL
                AND external_assignee_name IS NULL
                AND external_assignee_phone IS NULL
                AND external_assignee_email IS NULL
            )
            OR (
                task_audience = 'external'
                AND external_assignee_type IN ('driver', 'hotel', 'clinic', 'partner', 'other')
                AND NULLIF(BTRIM(external_assignee_name), '') IS NOT NULL
            )
        );

CREATE INDEX IF NOT EXISTS idx_tasks_operational_patient_created
    ON tasks (patient_id, created_at DESC)
    WHERE task_scope = 'concierge_operational' AND patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_operational_audience_status
    ON tasks (task_audience, status, created_at DESC)
    WHERE task_scope = 'concierge_operational';

