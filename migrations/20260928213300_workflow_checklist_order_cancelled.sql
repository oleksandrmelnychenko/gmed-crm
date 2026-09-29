-- Cancelling an order (manually or by terminating the framework contract)
-- resolves its still-open checklist items as "not required" with the new
-- reason order_cancelled and cancels their linked tasks (owner decision
-- 2026-09-28). Such an item cannot be reopened.
ALTER TABLE workflow_checklist_items
    DROP CONSTRAINT workflow_checklist_items_not_required_reason_check,
    ADD CONSTRAINT workflow_checklist_items_not_required_reason_check
        CHECK (
            not_required_reason IS NULL
            OR not_required_reason IN ('manual', 'phase_passed', 'task_cancelled', 'order_cancelled')
        );

-- One-off repair: orders cancelled before this change kept their open
-- checklist items and tasks. Resolve them the same way, as done by the
-- order's canceller (else its creator), and cancel their still-open linked
-- tasks with a history entry. Every item and task change is audited in this
-- transaction; nothing is deleted.
WITH resolved AS (
    UPDATE workflow_checklist_items item
    SET is_completed = true,
        not_required = true,
        not_required_reason = 'order_cancelled',
        completed_by = COALESCE(o.cancelled_by, o.created_by),
        completed_at = COALESCE(o.cancelled_at, now()),
        updated_at = now()
    FROM orders o
    WHERE o.id = item.order_id
      AND item.scope_type = 'order'
      AND o.status = 'cancelled'
      AND NOT item.is_completed
    RETURNING item.id, item.patient_id, item.order_id, item.scope_type, item.scope_id,
              item.item_text, item.linked_task_id, item.completed_by
),
item_audit AS (
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
    SELECT NULL,
           'workflow_checklist_item_not_required',
           'patient',
           resolved.patient_id,
           jsonb_build_object(
               'scope_type', resolved.scope_type,
               'scope_id', resolved.scope_id,
               'order_id', resolved.order_id,
               'checklist_item_id', resolved.id,
               'task_id', resolved.linked_task_id,
               'item_text', resolved.item_text,
               'change', 'not_required',
               'not_required_reason', 'order_cancelled',
               'repair', '20260928213300_workflow_checklist_order_cancelled'
           )
    FROM resolved
    RETURNING id
),
open_tasks AS (
    SELECT task.id, task.status AS previous_status, resolved.completed_by AS actor_id
    FROM tasks task
    JOIN resolved ON resolved.linked_task_id = task.id
    WHERE task.deleted_at IS NULL
      AND task.status NOT IN ('completed', 'cancelled')
),
cancelled_tasks AS (
    UPDATE tasks task
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    FROM open_tasks
    WHERE task.id = open_tasks.id
    RETURNING task.id, open_tasks.previous_status, open_tasks.actor_id
),
task_history AS (
    INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
    SELECT id, 'status_changed', actor_id,
           jsonb_build_object(
               'status', 'cancelled',
               'previous_status', previous_status,
               'reason', 'checklist_item_not_required',
               'not_required_reason', 'order_cancelled'
           )
    FROM cancelled_tasks
    RETURNING task_id
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'update_concierge_operational_item_status',
       'task',
       cancelled_tasks.id,
       jsonb_build_object(
           'status', 'cancelled',
           'previous_status', cancelled_tasks.previous_status,
           'reason', 'order_cancelled',
           'repair', '20260928213300_workflow_checklist_order_cancelled'
       )
FROM cancelled_tasks;
