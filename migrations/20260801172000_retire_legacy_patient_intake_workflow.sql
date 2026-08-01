UPDATE tasks
SET status = 'cancelled',
    updated_at = now()
WHERE status IN ('open', 'in_progress')
  AND id IN (
      SELECT linked_task_id
      FROM workflow_checklist_items
      WHERE scope_type = 'patient'
        AND checklist_key = 'patient_intake'
        AND metadata @> '{"template": true}'::jsonb
        AND linked_task_id IS NOT NULL
  );

DELETE FROM workflow_checklist_items
WHERE scope_type = 'patient'
  AND checklist_key = 'patient_intake'
  AND metadata @> '{"template": true}'::jsonb;
