-- QA F05/F10 (owner approval 2026-11-14): repair legacy cancelled orders and
-- make `orders.cancelled_at` follow `orders.status` from now on.
--
-- Legacy shapes (final-F-orders.md): orders cancelled before 2026-09-27 (the
-- status change wrote only `status`), by the repeat-intake trigger (dropped in
-- 20261113210000) or by the one-off 20260913090000 recovery have no
-- `cancelled_at`, may keep still-planned service lines and open order
-- checklist items with open tasks. No application path sets `cancelled_at` on
-- an order that is not cancelled; such a row can only come from a manual
-- database edit.
--
-- Every changed row is audited in this transaction (system actor, user_id
-- NULL, context.repair names this migration); no audit row is rewritten and
-- nothing is deleted. All statements only touch inconsistent rows, so running
-- the file again changes nothing (crates/server/tests/
-- cancelled_order_consistency_repair_api.rs re-runs it on synthetic legacy
-- rows).

-- 1. Cancelled without cancelled_at: the time of the cancelling audit row
--    (legacy `update_order_status` or `cancel_order` with status cancelled),
--    else the order's last update. The source is recorded.
WITH source AS (
    SELECT o.id,
           cancelling.id AS audit_id,
           COALESCE(cancelling.created_at, o.updated_at) AS cancelled_at
    FROM orders o
    LEFT JOIN LATERAL (
        SELECT a.id, a.created_at
        FROM audit_log a
        WHERE a.entity_type = 'order'
          AND a.entity_id = o.id
          AND a.action IN ('update_order_status', 'cancel_order')
          AND a.context->>'status' = 'cancelled'
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 1
    ) cancelling ON true
    WHERE o.status = 'cancelled'
      AND o.cancelled_at IS NULL
),
fixed AS (
    UPDATE orders o
    SET cancelled_at = source.cancelled_at
    FROM source
    WHERE o.id = source.id
      AND o.status = 'cancelled'
      AND o.cancelled_at IS NULL
    RETURNING o.id, source.cancelled_at, source.audit_id
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'repair_order_cancelled_at',
       'order',
       fixed.id,
       jsonb_build_object(
           'status', 'cancelled',
           'cancelled_at', fixed.cancelled_at,
           'cancelled_at_source', CASE WHEN fixed.audit_id IS NULL THEN 'order_updated_at' ELSE 'audit_log' END,
           'source_audit_id', fixed.audit_id,
           'repair', '20261114120001_cancelled_order_consistency'
       )
FROM fixed;

-- 2. cancelled_at on an order that is not cancelled (manual database edit
--    only). The status is the business state every flow reads, so it wins:
--    the cancellation columns are cleared together, as returning an archived
--    lead's order to work does, and their old values are kept in the audit.
WITH stale AS (
    SELECT id, status, cancelled_at, cancelled_by, cancellation_reason
    FROM orders
    WHERE status <> 'cancelled'
      AND cancelled_at IS NOT NULL
),
cleared AS (
    UPDATE orders o
    SET cancelled_at = NULL,
        cancelled_by = NULL,
        cancellation_reason = NULL
    FROM stale
    WHERE o.id = stale.id
      AND o.status <> 'cancelled'
    RETURNING o.id, stale.status, stale.cancelled_at, stale.cancelled_by, stale.cancellation_reason
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'repair_order_clear_cancelled_at',
       'order',
       cleared.id,
       jsonb_build_object(
           'status', cleared.status,
           'previous_cancelled_at', cleared.cancelled_at,
           'previous_cancelled_by', cleared.cancelled_by,
           'previous_reason', cleared.cancellation_reason,
           'repair', '20261114120001_cancelled_order_consistency'
       )
FROM cleared;

-- 3a. Still-planned service lines of cancelled orders are cancelled. Their
--     cancellation columns stay empty, as for lines cancelled by a contract
--     termination (order_leistungen_cancellation_consistent needs an actor and
--     a reason for a staff cancellation); this audit row is their record.
WITH lines AS (
    UPDATE order_leistungen service
    SET status = 'cancelled'
    FROM orders o
    WHERE o.id = service.order_id
      AND o.status = 'cancelled'
      AND service.status = 'planned'
    RETURNING service.id, service.order_id
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
SELECT NULL,
       'repair_cancel_planned_order_service',
       'order',
       lines.order_id,
       jsonb_build_object(
           'order_leistung_id', lines.id,
           'from_status', 'planned',
           'status', 'cancelled',
           'reason', 'order_cancelled',
           'repair', '20261114120001_cancelled_order_consistency'
       )
FROM lines;

-- 3b. Open order checklist items of cancelled orders are resolved as
--     "not required" (order_cancelled) by the order's canceller (else its
--     creator) at its cancellation time, and their still-open linked tasks are
--     cancelled with a history entry, exactly as
--     20260928213300_workflow_checklist_order_cancelled did once.
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
               'repair', '20261114120001_cancelled_order_consistency'
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
           'repair', '20261114120001_cancelled_order_consistency'
       )
FROM cancelled_tasks;

-- 4. Steps 1 and 2 leave no row that breaks the rule, so the constraint is
--    added validated. Every application path writes status and cancelled_at
--    in the same UPDATE: cancel_order_in_tx (manual cancel, failed-lead
--    withdrawal), terminate_open_orders_tx (contract termination) and
--    reopen_withdrawn_lead_orders_in_tx (clears both).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cancelled_at_consistent;
ALTER TABLE orders
    ADD CONSTRAINT orders_cancelled_at_consistent
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));
