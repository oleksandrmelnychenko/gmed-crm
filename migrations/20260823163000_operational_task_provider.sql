ALTER TABLE tasks
    ADD COLUMN provider_id UUID REFERENCES providers(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_concierge_operational_provider
    ON tasks(provider_id, created_at DESC)
    WHERE task_scope = 'concierge_operational' AND provider_id IS NOT NULL;
