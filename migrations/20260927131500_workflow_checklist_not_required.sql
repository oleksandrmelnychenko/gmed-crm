-- Order and patient checklist items can be resolved as "not required"
-- ("не требуется") instead of completed: manually from the order page, when
-- the order moves past the item's stage, or when the linked task is cancelled.
-- A not-required item is closed (is_completed) so it no longer blocks the
-- order; not_required tells it apart from real completion and reopening clears
-- both.
ALTER TABLE workflow_checklist_items
    ADD COLUMN not_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN not_required_reason TEXT,
    ADD CONSTRAINT workflow_checklist_items_not_required_reason_check
        CHECK (
            not_required_reason IS NULL
            OR not_required_reason IN ('manual', 'phase_passed', 'task_cancelled')
        ),
    ADD CONSTRAINT workflow_checklist_items_not_required_state_check
        CHECK (
            (NOT not_required AND not_required_reason IS NULL)
            OR (not_required AND not_required_reason IS NOT NULL AND is_completed)
        );
