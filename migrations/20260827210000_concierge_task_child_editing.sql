-- Allow task collaborators to correct checklist labels and let comment authors
-- revise or remove their own comments without erasing the audit trail.

ALTER TABLE concierge_operational_task_checklist_items
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by UUID REFERENCES users(id);

ALTER TABLE concierge_operational_task_checklist_items
    ADD CONSTRAINT concierge_task_checklist_deleted_shape_check CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL)
        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
    );

CREATE INDEX idx_concierge_task_checklist_active
    ON concierge_operational_task_checklist_items(task_id, position, created_at)
    WHERE deleted_at IS NULL;

ALTER TABLE concierge_operational_task_comments
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN edited_at TIMESTAMPTZ,
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by UUID REFERENCES users(id);

-- The legacy trigger rejects every UPDATE. Remove it before backfilling the
-- new timestamp column; the migration is transactional, so the old trigger is
-- restored automatically if a later statement fails.
DROP TRIGGER prevent_concierge_task_comment_mutation
    ON concierge_operational_task_comments;

UPDATE concierge_operational_task_comments
SET updated_at = created_at;

ALTER TABLE concierge_operational_task_comments
    ADD CONSTRAINT concierge_task_comment_deleted_shape_check CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL)
        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
    );

CREATE INDEX idx_concierge_task_comments_active
    ON concierge_operational_task_comments(task_id, created_at, id)
    WHERE deleted_at IS NULL;

-- Comments remain protected from hard deletion. Edits and soft deletion are
-- authorized by the API and mirrored into the append-only task event stream.
CREATE OR REPLACE FUNCTION prevent_concierge_task_comment_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'concierge task comments cannot be hard-deleted';
END;
$$;

CREATE TRIGGER prevent_concierge_task_comment_hard_delete
    BEFORE DELETE ON concierge_operational_task_comments
    FOR EACH ROW EXECUTE FUNCTION prevent_concierge_task_comment_hard_delete();

COMMENT ON COLUMN concierge_operational_task_comments.edited_at IS
    'Last author edit time. Every edit is also recorded in concierge_operational_task_events.';
COMMENT ON COLUMN concierge_operational_task_comments.deleted_at IS
    'Soft-delete time. Deleted comment content remains available to the immutable audit stream.';
