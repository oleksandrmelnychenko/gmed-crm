-- Owner decision 2026-09-28 (care-tasks status reference, Q1 / Q3 / Q4):
-- the concierge task is the single source of truth of a concierge service.
--
-- Until now `tasks.status` and `concierge_services.status` / `billing_status`
-- (and the task's own copies `service_status` / `billing_status`) were never
-- synchronised: a service stayed planned or booked after its task was done,
-- so the concierge KPIs and the order closure gate drifted.
--
-- From now on, whenever the status of a service task changes (work center,
-- checklist, appointment cascade, sub-task closing, service surfaces), the
-- service's operational status and billing readiness are derived from it in
-- the same transaction:
--
--   task status                      service status              billing
--   completed                        completed                   draft -> ready
--   cancelled                        cancelled                   draft / ready -> waived
--                                                                (billed / settled: refused)
--   open / in_progress / on_hold /   booking progress kept       unchanged
--   review                           (planned, booked,
--                                    confirmed, in_service)
--   reopened from completed          in_service                  ready -> draft
--   reopened from cancelled          planned                     waived -> draft
--
-- A service status that contradicts its task is refused (the service
-- surfaces change the task first). Billing moves only draft -> ready ->
-- billed -> settled, waived only from draft or ready (and back to draft only
-- when the task is reopened); the amounts of a billed or settled service are
-- locked.
--
-- The migration is written to be re-runnable: it drops its triggers first,
-- repairs the existing rows, and installs the triggers again.

ALTER TABLE concierge_services
    ADD COLUMN IF NOT EXISTS booking_decision_required_at TIMESTAMPTZ;

COMMENT ON COLUMN concierge_services.booking_decision_required_at IS
    'Set when the linked appointment was cancelled (or stopped being non-medical) while the service had a partner booking or was billed: the booking is not cancelled automatically, the concierge is notified and the appointment shows in the attention list until someone keeps or cancels the service.';

CREATE INDEX IF NOT EXISTS idx_tasks_concierge_service_live
    ON tasks (concierge_service_id, created_at, id)
    WHERE concierge_service_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_concierge_services_booking_decision
    ON concierge_services (appointment_id)
    WHERE booking_decision_required_at IS NOT NULL;

-- The canonical task of a service: its oldest live work-center task, an
-- operational one first (the order the API always used to pick it).
CREATE OR REPLACE FUNCTION concierge_service_canonical_task_id(p_service_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT task.id
    FROM tasks task
    WHERE task.concierge_service_id = p_service_id
      AND task.deleted_at IS NULL
      AND task.task_scope IN ('general', 'concierge_operational')
    ORDER BY (task.task_scope = 'concierge_operational') DESC, task.created_at, task.id
    LIMIT 1
$$;

-- The staff member who coordinates the services of a patient: the first
-- concierge assigned to the patient, else the first patient manager, else
-- the CEO. Author of tasks created for patient-portal requests (Q15).
CREATE OR REPLACE FUNCTION concierge_service_coordinator_id(p_patient_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT staff.id
            FROM patient_assignments assignment
            JOIN users staff ON staff.id = assignment.user_id
            WHERE assignment.patient_id = p_patient_id
              AND assignment.revoked_at IS NULL
              AND staff.is_active
              AND staff.role = 'concierge'
            ORDER BY assignment.assigned_at, staff.name, staff.id
            LIMIT 1
        ),
        (
            SELECT staff.id
            FROM patient_assignments assignment
            JOIN users staff ON staff.id = assignment.user_id
            WHERE assignment.patient_id = p_patient_id
              AND assignment.revoked_at IS NULL
              AND staff.is_active
              AND staff.role = 'patient_manager'
            ORDER BY assignment.assigned_at, staff.name, staff.id
            LIMIT 1
        ),
        (
            SELECT staff.id
            FROM users staff
            WHERE staff.is_active
              AND staff.role = 'ceo'
            ORDER BY staff.created_at, staff.id
            LIMIT 1
        )
    )
$$;

-- Service status for a task status; an active task keeps the booking
-- progress of the service, a reopened one leaves the closed state.
CREATE OR REPLACE FUNCTION concierge_service_status_for_task(
    p_task_status TEXT,
    p_service_status TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_task_status = 'completed' THEN 'completed'
        WHEN p_task_status = 'cancelled' THEN 'cancelled'
        WHEN p_service_status = 'completed' THEN 'in_service'
        WHEN p_service_status = 'cancelled' THEN 'planned'
        ELSE p_service_status
    END
$$;

-- Billing readiness follows the task's transitions only; a manual waiver of
-- an active service is not undone by an unrelated status change.
CREATE OR REPLACE FUNCTION concierge_billing_status_for_task(
    p_previous_task_status TEXT,
    p_task_status TEXT,
    p_billing_status TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_task_status IS NOT DISTINCT FROM p_previous_task_status THEN p_billing_status
        WHEN p_task_status = 'completed' AND p_billing_status = 'draft' THEN 'ready'
        WHEN p_task_status = 'cancelled' AND p_billing_status IN ('draft', 'ready') THEN 'waived'
        WHEN p_task_status NOT IN ('completed', 'cancelled')
             AND p_previous_task_status = 'completed'
             AND p_billing_status = 'ready' THEN 'draft'
        WHEN p_task_status NOT IN ('completed', 'cancelled')
             AND p_previous_task_status = 'cancelled'
             AND p_billing_status = 'waived' THEN 'draft'
        ELSE p_billing_status
    END
$$;

CREATE OR REPLACE FUNCTION concierge_service_status_matches_task(
    p_task_status TEXT,
    p_service_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_task_status = 'completed' THEN p_service_status = 'completed'
        WHEN p_task_status = 'cancelled' THEN p_service_status = 'cancelled'
        ELSE p_service_status NOT IN ('completed', 'cancelled')
    END
$$;

-- Every billing move the database accepts. The API is stricter for manual
-- changes (ready only for a completed service, draft only through a reopened
-- task).
CREATE OR REPLACE FUNCTION concierge_billing_transition_allowed(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_from = p_to
        OR (p_from, p_to) IN (
            ('draft', 'ready'),
            ('draft', 'waived'),
            ('ready', 'billed'),
            ('ready', 'waived'),
            ('ready', 'draft'),
            ('billed', 'settled'),
            ('waived', 'draft')
        )
$$;

DROP TRIGGER IF EXISTS derive_concierge_task_service_state ON tasks;
DROP TRIGGER IF EXISTS sync_concierge_service_from_task ON tasks;
DROP TRIGGER IF EXISTS guard_concierge_service_state ON concierge_services;

-- Repair 1: a closed service whose task is still active was closed on the
-- service side (service form, appointment completion or cancellation) under
-- the old rules, which never touched the task. Under the new rules closing
-- the service closes its task, so the task follows the closed service here;
-- un-completing delivered services would drop them from billing and from the
-- order closure evidence. Tasks that back a workflow checklist item are left
-- to repair 2 (the service follows them). Each task gets a history entry and
-- an audit row; nothing is deleted.
WITH stale_tasks AS (
    SELECT task.id AS task_id,
           task.status AS previous_status,
           task.assigned_to,
           service.id AS service_id,
           service.status AS service_status,
           service.completed_at AS service_completed_at
    FROM concierge_services service
    JOIN tasks task ON task.id = concierge_service_canonical_task_id(service.id)
    WHERE service.status IN ('completed', 'cancelled')
      AND task.status NOT IN ('completed', 'cancelled')
      AND task.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM workflow_checklist_items item
          WHERE item.linked_task_id = task.id
      )
    FOR UPDATE OF task
),
closed_tasks AS (
    UPDATE tasks task
    SET status = stale_tasks.service_status,
        completed_at = CASE
            WHEN stale_tasks.service_status = 'completed'
                THEN COALESCE(task.completed_at, stale_tasks.service_completed_at, now())
            ELSE NULL
        END,
        updated_at = now()
    FROM stale_tasks
    WHERE task.id = stale_tasks.task_id
    RETURNING task.id, task.status, stale_tasks.previous_status, task.assigned_to,
              stale_tasks.service_id
),
history AS (
    INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
    SELECT closed_tasks.id,
           'status_changed',
           NULL,
           jsonb_build_object(
               'assigned_to', closed_tasks.assigned_to,
               'status', closed_tasks.status,
               'previous_status', closed_tasks.previous_status,
               'reason', 'service_already_closed',
               'concierge_service_id', closed_tasks.service_id,
               'repair', '20260928212000_concierge_service_follows_task'
           )
    FROM closed_tasks
    RETURNING task_id
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'close_concierge_task_of_closed_service',
       'task',
       closed_tasks.id,
       jsonb_build_object('status', closed_tasks.previous_status),
       jsonb_build_object('status', closed_tasks.status),
       jsonb_build_object(
           'concierge_service_id', closed_tasks.service_id,
           'reason', 'service_already_closed',
           'repair', '20260928212000_concierge_service_follows_task'
       )
FROM closed_tasks;

-- Repair 2: every other service follows its canonical task (a service left
-- planned or booked after its task was completed or cancelled). The billing
-- readiness of a completed task is "ready", of a cancelled one "waived";
-- billed and settled services keep their billing. Audited per service.
WITH derived AS (
    SELECT service.id AS service_id,
           service.status AS previous_status,
           service.billing_status AS previous_billing_status,
           task.id AS task_id,
           task.status AS task_status,
           concierge_service_status_for_task(task.status, service.status) AS next_status,
           CASE
               WHEN task.status = 'completed' AND service.billing_status = 'draft' THEN 'ready'
               WHEN task.status = 'cancelled' AND service.billing_status IN ('draft', 'ready')
                   THEN 'waived'
               ELSE service.billing_status
           END AS next_billing_status,
           COALESCE(service.completed_at, task.completed_at, task.updated_at) AS completion_time
    FROM concierge_services service
    JOIN tasks task ON task.id = concierge_service_canonical_task_id(service.id)
    FOR UPDATE OF service
),
changed AS (
    UPDATE concierge_services service
    SET status = derived.next_status,
        billing_status = derived.next_billing_status,
        completed_at = CASE
            WHEN derived.next_status = 'completed' THEN derived.completion_time
            ELSE NULL
        END
    FROM derived
    WHERE service.id = derived.service_id
      AND (
          derived.next_status IS DISTINCT FROM derived.previous_status
          OR derived.next_billing_status IS DISTINCT FROM derived.previous_billing_status
      )
    RETURNING service.id, service.patient_id, service.status, service.billing_status,
              derived.previous_status, derived.previous_billing_status,
              derived.task_id, derived.task_status
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'derive_concierge_service_from_task',
       'concierge_service',
       changed.id,
       jsonb_build_object(
           'status', changed.previous_status,
           'billing_status', changed.previous_billing_status
       ),
       jsonb_build_object('status', changed.status, 'billing_status', changed.billing_status),
       jsonb_build_object(
           'patient_id', changed.patient_id,
           'task_id', changed.task_id,
           'task_status', changed.task_status,
           'reason', 'backfill',
           'repair', '20260928212000_concierge_service_follows_task'
       )
FROM changed;

-- The canonical task's copies of the service state mirror the service.
UPDATE tasks task
SET service_status = service.status,
    billing_status = service.billing_status
FROM concierge_services service
WHERE task.id = concierge_service_canonical_task_id(service.id)
  AND (
      task.service_status IS DISTINCT FROM service.status
      OR task.billing_status IS DISTINCT FROM service.billing_status
  );

-- Before a task row is written: its copies of the service state are derived
-- from the task status. A cancelled task of a billed or settled service is
-- refused (it needs a credit note or an invoice reversal). A soft-deleted
-- task only detaches from its service.
CREATE OR REPLACE FUNCTION derive_concierge_task_service_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_task_status TEXT;
    linked_status TEXT;
    linked_billing TEXT;
    base_status TEXT;
    base_billing TEXT;
BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.status IS NOT DISTINCT FROM OLD.status
           AND NEW.concierge_service_id IS NOT DISTINCT FROM OLD.concierge_service_id THEN
            RETURN NEW;
        END IF;
        IF NEW.concierge_service_id IS NOT DISTINCT FROM OLD.concierge_service_id THEN
            previous_task_status := OLD.status;
        END IF;
    END IF;

    IF NEW.concierge_service_id IS NOT NULL THEN
        SELECT service.status, service.billing_status
        INTO linked_status, linked_billing
        FROM concierge_services service
        WHERE service.id = NEW.concierge_service_id
        FOR UPDATE;
    END IF;

    -- A statement that sets the booking progress together with the status
    -- (provider booking) states the new progress itself.
    IF TG_OP = 'UPDATE' AND NEW.service_status IS DISTINCT FROM OLD.service_status THEN
        base_status := NEW.service_status;
    ELSE
        base_status := COALESCE(linked_status, NEW.service_status);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.billing_status IS DISTINCT FROM OLD.billing_status THEN
        base_billing := NEW.billing_status;
    ELSE
        base_billing := COALESCE(linked_billing, NEW.billing_status);
    END IF;
    IF base_status IS NULL THEN
        RETURN NEW;
    END IF;

    IF previous_task_status IS NOT NULL
       AND previous_task_status <> 'cancelled'
       AND NEW.status = 'cancelled'
       AND base_billing IN ('billed', 'settled') THEN
        RAISE EXCEPTION 'concierge_service_billed: a billed concierge service cannot be cancelled; issue a credit note or reverse the invoice first'
            USING ERRCODE = '23514';
    END IF;

    NEW.service_status := concierge_service_status_for_task(NEW.status, base_status);
    NEW.billing_status := concierge_billing_status_for_task(
        previous_task_status,
        NEW.status,
        base_billing
    );
    RETURN NEW;
END;
$$;

-- After a task row is written: its service takes the derived state, and the
-- change is audited in the same transaction. The acting user is the one the
-- API names with set_config('gmed.audit_actor_id', ..., true); automatic
-- changes without one keep the task id as their trace.
CREATE OR REPLACE FUNCTION sync_concierge_service_from_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_status TEXT;
    previous_billing TEXT;
    actor_setting TEXT;
    actor UUID;
BEGIN
    IF NEW.concierge_service_id IS NULL
       OR NEW.deleted_at IS NOT NULL
       OR NEW.service_status IS NULL THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.concierge_service_id IS NOT DISTINCT FROM OLD.concierge_service_id THEN
        RETURN NULL;
    END IF;
    IF concierge_service_canonical_task_id(NEW.concierge_service_id) IS DISTINCT FROM NEW.id THEN
        RETURN NULL;
    END IF;

    SELECT service.status, service.billing_status
    INTO previous_status, previous_billing
    FROM concierge_services service
    WHERE service.id = NEW.concierge_service_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF previous_status IS NOT DISTINCT FROM NEW.service_status
       AND previous_billing IS NOT DISTINCT FROM NEW.billing_status THEN
        RETURN NULL;
    END IF;

    UPDATE concierge_services
    SET status = NEW.service_status,
        billing_status = NEW.billing_status,
        completed_at = CASE
            WHEN NEW.service_status = 'completed'
                THEN COALESCE(completed_at, NEW.completed_at, now())
            ELSE NULL
        END,
        booking_decision_required_at = CASE
            WHEN NEW.service_status IN ('completed', 'cancelled') THEN NULL
            ELSE booking_decision_required_at
        END
    WHERE id = NEW.concierge_service_id;

    actor_setting := NULLIF(current_setting('gmed.audit_actor_id', true), '');
    IF actor_setting ~ '^[0-9a-fA-F-]{36}$' THEN
        actor := actor_setting::uuid;
    END IF;
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
    VALUES (
        actor,
        'derive_concierge_service_from_task',
        'concierge_service',
        NEW.concierge_service_id,
        jsonb_build_object('status', previous_status, 'billing_status', previous_billing),
        jsonb_build_object('status', NEW.service_status, 'billing_status', NEW.billing_status),
        jsonb_build_object(
            'task_id', NEW.id,
            'task_status', NEW.status,
            'previous_task_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
            'reason', 'task_status_changed'
        )
    );
    RETURN NULL;
END;
$$;

-- A service write that contradicts its task, an unknown billing move, or a
-- changed amount of a billed service is refused.
CREATE OR REPLACE FUNCTION guard_concierge_service_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    linked_task_status TEXT;
BEGIN
    IF NEW.billing_status IS DISTINCT FROM OLD.billing_status
       AND NOT concierge_billing_transition_allowed(OLD.billing_status, NEW.billing_status) THEN
        RAISE EXCEPTION 'concierge_service_billing_transition: billing status cannot move from % to %',
            OLD.billing_status, NEW.billing_status
            USING ERRCODE = '23514';
    END IF;
    IF OLD.billing_status IN ('billed', 'settled')
       AND (
           NEW.cost_estimate IS DISTINCT FROM OLD.cost_estimate
           OR NEW.actual_cost IS DISTINCT FROM OLD.actual_cost
           OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.currency IS DISTINCT FROM OLD.currency
       ) THEN
        RAISE EXCEPTION 'concierge_service_amounts_locked: the amounts of a billed concierge service cannot change'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        SELECT task.status
        INTO linked_task_status
        FROM tasks task
        WHERE task.id = concierge_service_canonical_task_id(NEW.id);
        IF linked_task_status IS NOT NULL
           AND NOT concierge_service_status_matches_task(linked_task_status, NEW.status) THEN
            RAISE EXCEPTION 'concierge_service_follows_task: service status % contradicts its task status %',
                NEW.status, linked_task_status
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER derive_concierge_task_service_state
    BEFORE INSERT OR UPDATE OF status, concierge_service_id ON tasks
    FOR EACH ROW EXECUTE FUNCTION derive_concierge_task_service_state();

CREATE TRIGGER sync_concierge_service_from_task
    AFTER INSERT OR UPDATE OF status, concierge_service_id ON tasks
    FOR EACH ROW EXECUTE FUNCTION sync_concierge_service_from_task();

CREATE TRIGGER guard_concierge_service_state
    BEFORE UPDATE ON concierge_services
    FOR EACH ROW EXECUTE FUNCTION guard_concierge_service_state();
