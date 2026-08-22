CREATE TABLE document_auto_naming_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    provisional_auto_name TEXT NOT NULL,
    requested_by UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'processing', 'completed', 'failed')
    ),
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_code TEXT,
    worker_id TEXT,
    locked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_auto_naming_jobs_queue
    ON document_auto_naming_jobs(status, created_at)
    WHERE status IN ('queued', 'processing');

CREATE TRIGGER set_updated_at_document_auto_naming_jobs
    BEFORE UPDATE ON document_auto_naming_jobs
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
