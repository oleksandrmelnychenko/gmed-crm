ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id);

ALTER TABLE tasks
    ADD CONSTRAINT tasks_archive_shape_check
        CHECK (
            (archived_at IS NULL AND archived_by IS NULL)
            OR (archived_at IS NOT NULL AND archived_by IS NOT NULL)
        ),
    ADD CONSTRAINT tasks_concierge_operational_archive_state_check
        CHECK (
            archived_at IS NULL
            OR (
                task_scope = 'concierge_operational'
                AND status IN ('completed', 'cancelled')
            )
        );

CREATE INDEX idx_tasks_concierge_operational_archive_state
    ON tasks (archived_at, created_at DESC)
    WHERE task_scope = 'concierge_operational' AND deleted_at IS NULL;
