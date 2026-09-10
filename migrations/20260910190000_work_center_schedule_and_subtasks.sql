-- Work Center: planned task intervals, explicit hold state and immutable hierarchy.
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('open', 'in_progress', 'on_hold', 'review', 'completed', 'cancelled'));

ALTER TABLE tasks DROP CONSTRAINT tasks_work_center_schedule_shape_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_work_center_schedule_shape_check CHECK (
    (task_kind = 'task' AND ends_at IS NULL
        AND (starts_at IS NULL OR due_date IS NULL OR due_date > starts_at))
    OR (task_kind = 'event' AND due_date IS NULL)
);

ALTER TABLE tasks ADD COLUMN parent_task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT;
CREATE INDEX idx_tasks_parent_task ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- Only new children can be linked. Immutable links to an existing parent cannot
-- introduce cycles, including concurrent requests. Serialize against deletion.
CREATE FUNCTION guard_work_center_parent() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id THEN
        RAISE EXCEPTION 'Task parent cannot be changed';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.parent_task_id IS NOT NULL THEN
        IF NEW.parent_task_id = NEW.id OR NOT EXISTS (
            SELECT 1 FROM tasks WHERE id = NEW.parent_task_id
              AND task_kind = 'task' AND deleted_at IS NULL AND archived_at IS NULL
              AND status NOT IN ('completed', 'cancelled') FOR UPDATE
        ) THEN
            RAISE EXCEPTION 'Parent must be an active task';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE'
       AND ((NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
         OR (NEW.task_kind = 'event' AND OLD.task_kind = 'task'))
       AND EXISTS (SELECT 1 FROM tasks WHERE parent_task_id = NEW.id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Task with children cannot be deleted or converted to an event';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_work_center_parent BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION guard_work_center_parent();
