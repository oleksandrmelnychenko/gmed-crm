-- Owner decision 2026-09-28 (care-tasks status reference, Q15): a task made
-- for a patient-portal service request is authored by the staff member who
-- coordinates the patient's services, never by the patient.
--
-- Until now the canonical task of a portal request copied the request's
-- creator, the patient, as its author (`assigned_by`) and, without an
-- assigned concierge, even as its assignee. Only the CEO could then close
-- such a task (nobody else is "the author or a higher role"), and the
-- work-center notices about it went to the patient.
--
-- Every task whose author (or assignee) is a patient account now gets the
-- coordinator as author: the first concierge assigned to the patient, else
-- the first patient manager, else the CEO (concierge_service_coordinator_id,
-- the rule the API uses for new tasks). A patient assignee becomes the
-- service's assigned concierge or the coordinator. The task history gets a
-- "reassigned" entry and every corrected task an audit row with the previous
-- values; nothing is deleted. Re-running the migration changes nothing more.
WITH patient_tasks AS (
    SELECT task.id,
           task.assigned_by AS previous_assigned_by,
           task.assigned_to AS previous_assigned_to,
           task.concierge_service_id,
           service.assigned_concierge_id,
           author.role AS author_role,
           assignee.role AS assignee_role,
           concierge_service_coordinator_id(COALESCE(service.patient_id, task.patient_id))
               AS coordinator_id
    FROM tasks task
    JOIN users author ON author.id = task.assigned_by
    JOIN users assignee ON assignee.id = task.assigned_to
    LEFT JOIN concierge_services service ON service.id = task.concierge_service_id
    WHERE author.role = 'patient' OR assignee.role = 'patient'
    FOR UPDATE OF task
),
corrected AS (
    UPDATE tasks task
    SET assigned_by = CASE
            WHEN patient_tasks.author_role = 'patient' THEN patient_tasks.coordinator_id
            ELSE task.assigned_by
        END,
        assigned_to = CASE
            WHEN patient_tasks.assignee_role = 'patient'
                THEN COALESCE(patient_tasks.assigned_concierge_id, patient_tasks.coordinator_id)
            ELSE task.assigned_to
        END,
        updated_at = now()
    FROM patient_tasks
    WHERE task.id = patient_tasks.id
      AND patient_tasks.coordinator_id IS NOT NULL
    RETURNING task.id, task.assigned_by, task.assigned_to, task.concierge_service_id,
              patient_tasks.previous_assigned_by, patient_tasks.previous_assigned_to
),
history AS (
    INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
    SELECT corrected.id,
           'reassigned',
           NULL,
           jsonb_build_object(
               'assigned_to', corrected.assigned_to,
               'previous_assigned_to', corrected.previous_assigned_to,
               'assigned_by', corrected.assigned_by,
               'previous_assigned_by', corrected.previous_assigned_by,
               'concierge_service_id', corrected.concierge_service_id,
               'reason', 'patient_author_replaced',
               'repair', '20260928212100_concierge_task_author_not_patient'
           )
    FROM corrected
    RETURNING task_id
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'replace_patient_task_author',
       'task',
       corrected.id,
       jsonb_build_object(
           'assigned_by', corrected.previous_assigned_by,
           'assigned_to', corrected.previous_assigned_to
       ),
       jsonb_build_object(
           'assigned_by', corrected.assigned_by,
           'assigned_to', corrected.assigned_to
       ),
       jsonb_build_object(
           'concierge_service_id', corrected.concierge_service_id,
           'reason', 'patient_author_replaced',
           'repair', '20260928212100_concierge_task_author_not_patient'
       )
FROM corrected;
