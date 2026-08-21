-- Complete the non-clinical Concierge task manager with reminders, checklists,
-- comments and an append-only activity stream. All child records are guarded
-- so they can only reference tasks from the dedicated concierge scope.

ALTER TABLE tasks
    ADD COLUMN reminder_at TIMESTAMPTZ,
    ADD COLUMN reminder_sent_at TIMESTAMPTZ;

ALTER TABLE tasks
    ADD CONSTRAINT tasks_concierge_reminder_scope_check
        CHECK (
            task_scope = 'concierge_operational'
            OR (reminder_at IS NULL AND reminder_sent_at IS NULL)
        ),
    ADD CONSTRAINT tasks_reminder_delivery_order_check
        CHECK (reminder_sent_at IS NULL OR reminder_at IS NOT NULL);

CREATE INDEX idx_tasks_concierge_operational_reminder_due
    ON tasks (reminder_at, assigned_to)
    WHERE task_scope = 'concierge_operational'
      AND reminder_at IS NOT NULL
      AND reminder_sent_at IS NULL
      AND status IN ('open', 'in_progress');

CREATE TABLE concierge_operational_task_checklist_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 500),
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    request_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT concierge_task_checklist_completion_shape_check CHECK (
        (is_completed AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
        OR (NOT is_completed AND completed_by IS NULL AND completed_at IS NULL)
    ),
    CONSTRAINT concierge_task_checklist_request_unique UNIQUE (task_id, request_id)
);

CREATE INDEX idx_concierge_task_checklist_task
    ON concierge_operational_task_checklist_items(task_id, position, created_at);

CREATE TABLE concierge_operational_task_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    created_by UUID NOT NULL REFERENCES users(id),
    request_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT concierge_task_comment_request_unique UNIQUE (task_id, request_id)
);

CREATE INDEX idx_concierge_task_comments_task
    ON concierge_operational_task_comments(task_id, created_at, id);

CREATE TABLE concierge_operational_task_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
    actor_id UUID REFERENCES users(id),
    request_id UUID,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_concierge_task_events_request_unique
    ON concierge_operational_task_events(task_id, request_id)
    WHERE request_id IS NOT NULL;

CREATE INDEX idx_concierge_task_events_task
    ON concierge_operational_task_events(task_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION guard_concierge_operational_task_child()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id
          AND task_scope = 'concierge_operational'
    ) THEN
        RAISE EXCEPTION 'concierge task child must reference an operational Concierge task';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_concierge_task_checklist_scope
    BEFORE INSERT OR UPDATE OF task_id
    ON concierge_operational_task_checklist_items
    FOR EACH ROW EXECUTE FUNCTION guard_concierge_operational_task_child();

CREATE TRIGGER guard_concierge_task_comment_scope
    BEFORE INSERT OR UPDATE OF task_id
    ON concierge_operational_task_comments
    FOR EACH ROW EXECUTE FUNCTION guard_concierge_operational_task_child();

CREATE TRIGGER guard_concierge_task_event_scope
    BEFORE INSERT OR UPDATE OF task_id
    ON concierge_operational_task_events
    FOR EACH ROW EXECUTE FUNCTION guard_concierge_operational_task_child();

CREATE OR REPLACE FUNCTION prevent_concierge_task_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'concierge task comments and events are append-only';
END;
$$;

CREATE TRIGGER prevent_concierge_task_comment_mutation
    BEFORE UPDATE OR DELETE ON concierge_operational_task_comments
    FOR EACH ROW EXECUTE FUNCTION prevent_concierge_task_append_only_mutation();

CREATE TRIGGER prevent_concierge_task_event_mutation
    BEFORE UPDATE OR DELETE ON concierge_operational_task_events
    FOR EACH ROW EXECUTE FUNCTION prevent_concierge_task_append_only_mutation();

INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload, created_at)
SELECT id,
       'created',
       assigned_by,
       jsonb_build_object(
           'assigned_to', assigned_to,
           'kind', task_kind,
           'status', status,
           'migrated', true
       ),
       created_at
FROM tasks
WHERE task_scope = 'concierge_operational';
