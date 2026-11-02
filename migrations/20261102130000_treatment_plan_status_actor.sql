-- «План для пациента» shows who set the current agreement status and when
-- (QA round 13): the time also tells staff whether appointments were added
-- after the plan was sent, agreed or finalised.
ALTER TABLE order_planning_preparation
    ADD COLUMN treatment_plan_status_updated_at TIMESTAMPTZ,
    ADD COLUMN treatment_plan_status_updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill from the latest audited status change; a finalised plan without
-- such a row keeps its finalisation actor. The backfill is no edit of the
-- planning row: updated_at stays.
ALTER TABLE order_planning_preparation DISABLE TRIGGER set_updated_at_order_planning_preparation;

UPDATE order_planning_preparation AS planning
   SET treatment_plan_status_updated_at = latest.created_at,
       treatment_plan_status_updated_by = latest.user_id
  FROM (
        SELECT DISTINCT ON (entity_id) entity_id, user_id, created_at
          FROM audit_log
         WHERE action = 'update_order_planning_preparation'
           AND entity_type = 'order'
           AND context ->> 'treatment_plan_status' IS NOT NULL
         ORDER BY entity_id, created_at DESC, id DESC
       ) AS latest
 WHERE latest.entity_id = planning.order_id
   AND planning.treatment_plan_status <> 'draft';

UPDATE order_planning_preparation
   SET treatment_plan_status_updated_at = plan_finalized_at,
       treatment_plan_status_updated_by = plan_finalized_by
 WHERE treatment_plan_status = 'finalized'
   AND treatment_plan_status_updated_at IS NULL
   AND plan_finalized_at IS NOT NULL;

ALTER TABLE order_planning_preparation ENABLE TRIGGER set_updated_at_order_planning_preparation;
