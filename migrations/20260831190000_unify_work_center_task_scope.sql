-- Make tasks the canonical Work Center entity.  The legacy scope value stays
-- valid during the cutover, but new and migrated Work Center records use the
-- ordinary `general` scope.

-- Scope-specific constraints would reject the scope conversion.  Replace them
-- with task/event invariants that apply equally to canonical and legacy rows.
ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_concierge_reminder_scope_check,
    DROP CONSTRAINT IF EXISTS tasks_concierge_operational_archive_state_check,
    DROP CONSTRAINT IF EXISTS tasks_concierge_operational_schedule_shape_check,
    DROP CONSTRAINT IF EXISTS tasks_external_assignee_check,
    DROP CONSTRAINT IF EXISTS tasks_concierge_operational_context_check;

ALTER TABLE tasks
    ADD CONSTRAINT tasks_work_center_schedule_shape_check CHECK (
        (task_kind = 'task' AND starts_at IS NULL AND ends_at IS NULL)
        OR (task_kind = 'event' AND due_date IS NULL)
    ),
    ADD CONSTRAINT tasks_external_assignee_check CHECK (
        (
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
    ),
    ADD CONSTRAINT tasks_work_center_archive_state_check CHECK (
        archived_at IS NULL OR status IN ('completed', 'cancelled')
    );

-- Child records and the idempotency registry are retained for API and audit
-- compatibility, but they now belong to an ordinary task/event as well.
CREATE OR REPLACE FUNCTION guard_concierge_operational_task_child()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM tasks
        WHERE id = NEW.task_id
          AND task_scope IN ('general', 'concierge_operational')
    ) THEN
        RAISE EXCEPTION 'Work Center child must reference a task or event';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_concierge_operational_create_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM tasks
        WHERE id = NEW.task_id
          AND task_scope IN ('general', 'concierge_operational')
    ) THEN
        RAISE EXCEPTION 'create request must reference a task or event';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_concierge_operational_task_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM tasks
        WHERE id = NEW.task_id
          AND task_scope IN ('general', 'concierge_operational')
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'attachment must reference an active task or event';
    END IF;
    RETURN NEW;
END;
$$;

-- Preserve historical timestamps while changing the discriminator.  The
-- scope check deliberately continues accepting the legacy value so requests
-- already in flight can still finish safely.
ALTER TABLE tasks DISABLE TRIGGER set_updated_at_tasks;

UPDATE tasks
SET task_scope = 'general'
WHERE task_scope = 'concierge_operational';

ALTER TABLE tasks ENABLE TRIGGER set_updated_at_tasks;

-- Replace predicates that would otherwise stop serving rows after the scope
-- conversion.  Include the legacy value for rolling-deploy compatibility.
DROP INDEX IF EXISTS idx_tasks_concierge_operational_assignee;
DROP INDEX IF EXISTS idx_tasks_concierge_operational_service;
DROP INDEX IF EXISTS idx_tasks_concierge_operational_reminder_due;
DROP INDEX IF EXISTS idx_tasks_operational_patient_created;
DROP INDEX IF EXISTS idx_tasks_operational_audience_status;
DROP INDEX IF EXISTS idx_tasks_concierge_operational_provider;
DROP INDEX IF EXISTS idx_tasks_concierge_operational_active;
DROP INDEX IF EXISTS idx_tasks_concierge_operational_archive_state;

CREATE INDEX idx_tasks_work_center_assignee
    ON tasks (assigned_to, status, (COALESCE(starts_at, due_date)), created_at DESC)
    WHERE task_scope IN ('general', 'concierge_operational');

CREATE INDEX idx_tasks_work_center_service
    ON tasks (concierge_service_id)
    WHERE task_scope IN ('general', 'concierge_operational')
      AND concierge_service_id IS NOT NULL;

CREATE INDEX idx_tasks_work_center_reminder_due
    ON tasks (reminder_at, assigned_to)
    WHERE task_scope IN ('general', 'concierge_operational')
      AND reminder_at IS NOT NULL
      AND reminder_sent_at IS NULL
      AND status IN ('open', 'in_progress');

CREATE INDEX idx_tasks_work_center_patient_created
    ON tasks (patient_id, created_at DESC)
    WHERE task_scope IN ('general', 'concierge_operational')
      AND patient_id IS NOT NULL;

CREATE INDEX idx_tasks_work_center_audience_status
    ON tasks (task_audience, status, created_at DESC)
    WHERE task_scope IN ('general', 'concierge_operational');

CREATE INDEX idx_tasks_work_center_provider
    ON tasks (provider_id, created_at DESC)
    WHERE task_scope IN ('general', 'concierge_operational')
      AND provider_id IS NOT NULL;

CREATE INDEX idx_tasks_work_center_active
    ON tasks (created_at DESC)
    WHERE task_scope IN ('general', 'concierge_operational')
      AND deleted_at IS NULL;

CREATE INDEX idx_tasks_work_center_archive_state
    ON tasks (archived_at, created_at DESC)
    WHERE task_scope IN ('general', 'concierge_operational')
      AND deleted_at IS NULL;
