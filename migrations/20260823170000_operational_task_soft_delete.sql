ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

ALTER TABLE tasks
    ADD CONSTRAINT tasks_soft_delete_actor_check
        CHECK (
            (deleted_at IS NULL AND deleted_by IS NULL)
            OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
        );

CREATE INDEX IF NOT EXISTS idx_tasks_concierge_operational_active
    ON tasks(created_at DESC)
    WHERE task_scope = 'concierge_operational' AND deleted_at IS NULL;
