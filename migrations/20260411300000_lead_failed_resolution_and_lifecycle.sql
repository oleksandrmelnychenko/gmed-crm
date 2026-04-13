ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS failed_outcome_status TEXT NOT NULL DEFAULT 'none'
        CHECK (failed_outcome_status IN ('none', 'archived', 'delete_anonymized'));

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS failed_from_status TEXT;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS failed_reason TEXT;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS failed_note TEXT;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS failed_processed_at TIMESTAMPTZ;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS failed_processed_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_leads_failed_outcome_status
    ON leads(failed_outcome_status);

CREATE TABLE IF NOT EXISTS workflow_lifecycle_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'order')),
    entity_id UUID NOT NULL,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    transition_kind TEXT NOT NULL CHECK (
        transition_kind IN (
            'created',
            'status_change',
            'phase_change',
            'converted',
            'archived',
            'deleted'
        )
    ),
    note TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    changed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_lifecycle_events_entity
    ON workflow_lifecycle_events(entity_type, entity_id, created_at DESC);
