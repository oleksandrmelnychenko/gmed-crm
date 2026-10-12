-- A concierge service and its task share one assignee (QA C3-07, 2026-10-12).
--
-- A service added on /services without a concierge got its task (on "book
-- with partner", a key event, a quote, …) assigned to the patient's
-- coordinating concierge, but the service itself stayed without a concierge.
-- The work-center API names a task's service only when the service's
-- concierge is the task's assignee, so the task detail showed no booking
-- ("Подтвердить бронь") and no expenses although `tasks.concierge_service_id`
-- was set. `ensure_task_for_service` now gives such a service the concierge of
-- its new task, as linking a task in the work center always did
-- (20260827201000 repaired only work-center tasks).
--
-- Existing services: a service without a concierge whose canonical task is
-- assigned to an active concierge takes that concierge. Other assignees
-- (manager, CEO) are not concierges and are left alone.
UPDATE concierge_services service
SET assigned_concierge_id = task.assigned_to,
    updated_at = now()
FROM tasks task
JOIN users assignee ON assignee.id = task.assigned_to
WHERE service.assigned_concierge_id IS NULL
  AND task.id = concierge_service_canonical_task_id(service.id)
  AND assignee.role = 'concierge'
  AND assignee.is_active;
