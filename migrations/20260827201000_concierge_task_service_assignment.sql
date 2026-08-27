-- Keep service-generated Concierge tasks and their expense workflow on the same assignee.
-- Older tasks could retain a service link while the service itself was still unassigned;
-- the API then intentionally omitted the link and the expense section disappeared.
WITH latest_linked_task AS (
    SELECT DISTINCT ON (task.concierge_service_id)
           task.concierge_service_id,
           task.assigned_to
    FROM tasks task
    WHERE task.task_scope = 'concierge_operational'
      AND task.concierge_service_id IS NOT NULL
      AND task.deleted_at IS NULL
    ORDER BY task.concierge_service_id, task.updated_at DESC, task.id DESC
)
UPDATE concierge_services service
SET assigned_concierge_id = linked.assigned_to,
    updated_at = now()
FROM latest_linked_task linked
WHERE service.id = linked.concierge_service_id
  AND service.assigned_concierge_id IS NULL;
