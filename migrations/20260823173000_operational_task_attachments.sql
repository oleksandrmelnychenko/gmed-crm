CREATE TABLE concierge_operational_task_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    file_nonce BYTEA NOT NULL,
    encryption_key_id TEXT NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT concierge_operational_task_attachments_file_name_check
        CHECK (NULLIF(BTRIM(file_name), '') IS NOT NULL AND char_length(file_name) <= 255),
    CONSTRAINT concierge_operational_task_attachments_file_size_check
        CHECK (file_size > 0 AND file_size <= 20971520),
    CONSTRAINT concierge_operational_task_attachments_delete_shape_check
        CHECK (
            (deleted_at IS NULL AND deleted_by IS NULL)
            OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
        )
);

CREATE INDEX idx_concierge_operational_task_attachments_active
    ON concierge_operational_task_attachments (task_id, created_at, id)
    WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION guard_concierge_operational_task_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM tasks
        WHERE id = NEW.task_id
          AND task_scope = 'concierge_operational'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'attachment must reference an active operational task';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_concierge_operational_task_attachment_scope
    BEFORE INSERT OR UPDATE OF task_id
    ON concierge_operational_task_attachments
    FOR EACH ROW EXECUTE FUNCTION guard_concierge_operational_task_attachment();
