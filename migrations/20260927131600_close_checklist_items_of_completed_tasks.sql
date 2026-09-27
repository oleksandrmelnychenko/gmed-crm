-- One-off repair: until 2026-09-26 completing a checklist task in the work
-- center did not close its order/patient checklist item, so the item stayed
-- open and blocked the order although the task was done. Close those items
-- with the task's completion time and the user who completed it (the latest
-- change to "completed" in the task history, else the assignee). Every closed
-- item is audited in the same transaction as the repair; the audit row has no
-- acting user because the migration, not a person, made the change.
WITH task_completion AS (
    SELECT item.id AS item_id,
           task.id AS task_id,
           COALESCE(task.completed_at, task.updated_at) AS completed_at,
           COALESCE(
               (
                   SELECT event.actor_id
                   FROM concierge_operational_task_events event
                   WHERE event.task_id = task.id
                     AND event.actor_id IS NOT NULL
                     AND event.payload->>'status' = 'completed'
                     AND event.payload->>'previous_status' IS DISTINCT FROM 'completed'
                   ORDER BY event.created_at DESC
                   LIMIT 1
               ),
               task.assigned_to
           ) AS completed_by
    FROM workflow_checklist_items item
    JOIN tasks task ON task.id = item.linked_task_id
    WHERE NOT item.is_completed
      AND task.status = 'completed'
),
closed AS (
    UPDATE workflow_checklist_items item
    SET is_completed = true,
        completed_by = task_completion.completed_by,
        completed_at = task_completion.completed_at,
        updated_at = now()
    FROM task_completion
    WHERE item.id = task_completion.item_id
      AND NOT item.is_completed
    RETURNING item.id, item.patient_id, item.order_id, item.scope_type, item.scope_id,
              item.item_text, task_completion.task_id, task_completion.completed_by,
              task_completion.completed_at
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'workflow_checklist_item_completed',
       'patient',
       closed.patient_id,
       jsonb_build_object(
           'scope_type', closed.scope_type,
           'scope_id', closed.scope_id,
           'order_id', closed.order_id,
           'checklist_item_id', closed.id,
           'task_id', closed.task_id,
           'item_text', closed.item_text,
           'completed_via', 'task',
           'task_completed_by', closed.completed_by,
           'task_completed_at', closed.completed_at,
           'repair', '20260927131600_close_checklist_items_of_completed_tasks'
       )
FROM closed;
