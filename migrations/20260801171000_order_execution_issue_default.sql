ALTER TABLE order_execution_flows
    ALTER COLUMN issue_status SET DEFAULT 'not_required';

UPDATE order_execution_flows
SET issue_status = 'not_required'
WHERE issue_status = 'pending'
  AND NULLIF(BTRIM(COALESCE(deviation_note, '')), '') IS NULL
  AND issues_resolved_at IS NULL;
