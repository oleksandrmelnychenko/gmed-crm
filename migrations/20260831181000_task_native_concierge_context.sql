-- Move Concierge booking and finance context onto the canonical task/event.
--
-- This is intentionally an expand/backfill migration.  The legacy service and
-- service foreign keys remain available while the API is switched, but every
-- migrated child row receives a required task_id and new rows may be task-only.

ALTER TABLE tasks
    ADD COLUMN service_kind TEXT,
    ADD COLUMN service_status TEXT,
    ADD COLUMN provider_service_id UUID
        REFERENCES service_catalog(id) ON DELETE SET NULL,
    ADD COLUMN taxonomy_node_id UUID
        REFERENCES provider_taxonomy_nodes(id) ON DELETE SET NULL,
    ADD COLUMN request_source TEXT,
    ADD COLUMN booking_reference TEXT,
    ADD COLUMN vendor_name TEXT,
    ADD COLUMN vendor_contact TEXT,
    ADD COLUMN service_address TEXT,
    ADD COLUMN quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
    ADD COLUMN unit_price NUMERIC(12, 2),
    ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR',
    ADD COLUMN cost_estimate NUMERIC(12, 2),
    ADD COLUMN actual_cost NUMERIC(12, 2),
    ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN service_notes TEXT,
    ADD COLUMN billing_notes TEXT,
    ADD COLUMN billed_at TIMESTAMPTZ,
    ADD COLUMN key_status TEXT,
    ADD COLUMN key_responsible_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN key_status_at TIMESTAMPTZ;

ALTER TABLE tasks
    ADD CONSTRAINT tasks_service_kind_check CHECK (
        service_kind IS NULL
        OR service_kind IN (
            'hotel',
            'transfer',
            'vip_terminal',
            'flight',
            'chauffeur',
            'translation_support',
            'other'
        )
    ),
    ADD CONSTRAINT tasks_service_status_check CHECK (
        service_status IS NULL
        OR service_status IN (
            'planned',
            'booked',
            'confirmed',
            'in_service',
            'completed',
            'cancelled'
        )
    ),
    ADD CONSTRAINT tasks_request_source_check CHECK (
        request_source IS NULL
        OR request_source IN ('staff', 'patient_portal', 'appointment_bootstrap')
    ),
    ADD CONSTRAINT tasks_service_address_length_check CHECK (
        service_address IS NULL OR char_length(service_address) <= 500
    ),
    ADD CONSTRAINT tasks_currency_check CHECK (
        currency = upper(currency) AND currency ~ '^[A-Z]{3}$'
    ),
    ADD CONSTRAINT tasks_billing_status_check CHECK (
        billing_status IN ('draft', 'ready', 'billed', 'settled', 'waived')
    ),
    ADD CONSTRAINT tasks_key_status_check CHECK (
        key_status IS NULL
        OR key_status IN ('received', 'stored', 'handed_over', 'returned')
    );

CREATE INDEX idx_tasks_provider_service
    ON tasks(provider_service_id)
    WHERE provider_service_id IS NOT NULL;
CREATE INDEX idx_tasks_taxonomy_node
    ON tasks(taxonomy_node_id)
    WHERE taxonomy_node_id IS NOT NULL;
CREATE INDEX idx_tasks_billing_status
    ON tasks(billing_status, created_at DESC);
CREATE INDEX idx_tasks_key_responsible
    ON tasks(key_responsible_user_id)
    WHERE key_responsible_user_id IS NOT NULL;

-- A task can now retain the appointment which originated its non-medical
-- service.  Keep the legacy operational scope and its order prohibition until
-- the API cutover removes scope-specific behavior.
ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_concierge_operational_context_check,
    ADD CONSTRAINT tasks_concierge_operational_context_check CHECK (
        task_scope <> 'concierge_operational' OR order_id IS NULL
    );

CREATE TEMPORARY TABLE concierge_service_task_backfill_map (
    concierge_service_id UUID PRIMARY KEY,
    task_id UUID NOT NULL UNIQUE,
    created_by_migration BOOLEAN NOT NULL DEFAULT false
) ON COMMIT DROP;

-- Preserve the task id exposed by the legacy API.  It selected the oldest
-- active operational task for a service, so prefer that same row; also accept
-- an already-linked general task rather than manufacturing a duplicate.
INSERT INTO concierge_service_task_backfill_map (
    concierge_service_id,
    task_id,
    created_by_migration
)
SELECT DISTINCT ON (task.concierge_service_id)
       task.concierge_service_id,
       task.id,
       false
FROM tasks task
WHERE task.concierge_service_id IS NOT NULL
  AND task.deleted_at IS NULL
ORDER BY task.concierge_service_id,
         (task.task_scope = 'concierge_operational') DESC,
         task.created_at,
         task.id;

-- Services without a live linked task become ordinary records in tasks.  A
-- scheduled service is represented as an event; an unscheduled service remains
-- a task.  Invalid legacy end-before-start data is preserved on the service but
-- is not copied into the constrained task schedule.
WITH created_tasks AS (
    INSERT INTO tasks (
        title,
        description,
        assigned_to,
        assigned_by,
        patient_id,
        appointment_id,
        provider_id,
        due_date,
        priority,
        status,
        completed_at,
        task_scope,
        task_kind,
        concierge_service_id,
        starts_at,
        ends_at,
        location,
        task_audience,
        service_kind,
        service_status,
        provider_service_id,
        taxonomy_node_id,
        request_source,
        booking_reference,
        vendor_name,
        vendor_contact,
        service_address,
        quantity,
        unit_price,
        currency,
        cost_estimate,
        actual_cost,
        billing_status,
        service_notes,
        billing_notes,
        billed_at,
        key_status,
        key_responsible_user_id,
        key_status_at,
        created_at,
        updated_at
    )
    SELECT service.title,
           service.service_notes,
           COALESCE(service.assigned_concierge_id, service.created_by),
           service.created_by,
           service.patient_id,
           service.appointment_id,
           service.provider_id,
           CASE WHEN service.starts_at IS NULL THEN service.ends_at ELSE NULL END,
           'normal',
           CASE service.status
               WHEN 'completed' THEN 'completed'
               WHEN 'cancelled' THEN 'cancelled'
               WHEN 'planned' THEN 'open'
               ELSE 'in_progress'
           END,
           CASE
               WHEN service.status = 'completed'
               THEN COALESCE(service.completed_at, service.updated_at)
               ELSE NULL
           END,
           'concierge_operational',
           CASE WHEN service.starts_at IS NOT NULL THEN 'event' ELSE 'task' END,
           service.id,
           service.starts_at,
           CASE
               WHEN service.starts_at IS NOT NULL
                AND service.ends_at > service.starts_at
               THEN service.ends_at
               ELSE NULL
           END,
           service.service_address,
           'internal',
           service.service_kind,
           service.status,
           service.provider_service_id,
           service.taxonomy_node_id,
           service.request_source,
           service.booking_reference,
           service.vendor_name,
           service.vendor_contact,
           service.service_address,
           service.quantity,
           service.unit_price,
           CASE
               WHEN upper(btrim(service.currency)) ~ '^[A-Z]{3}$'
               THEN upper(btrim(service.currency))
               ELSE 'EUR'
           END,
           service.cost_estimate,
           service.actual_cost,
           service.billing_status,
           service.service_notes,
           service.billing_notes,
           service.billed_at,
           service.key_status,
           service.key_responsible_user_id,
           service.key_status_at,
           service.created_at,
           service.updated_at
    FROM concierge_services service
    WHERE NOT EXISTS (
        SELECT 1
        FROM concierge_service_task_backfill_map mapped
        WHERE mapped.concierge_service_id = service.id
    )
    RETURNING id, concierge_service_id
)
INSERT INTO concierge_service_task_backfill_map (
    concierge_service_id,
    task_id,
    created_by_migration
)
SELECT concierge_service_id, id, true
FROM created_tasks;

INSERT INTO concierge_operational_task_events (
    task_id,
    event_type,
    actor_id,
    payload,
    created_at
)
SELECT mapped.task_id,
       'created',
       service.created_by,
       jsonb_build_object(
           'assigned_to', COALESCE(service.assigned_concierge_id, service.created_by),
           'kind', CASE WHEN service.starts_at IS NOT NULL THEN 'event' ELSE 'task' END,
           'status', CASE service.status
               WHEN 'completed' THEN 'completed'
               WHEN 'cancelled' THEN 'cancelled'
               WHEN 'planned' THEN 'open'
               ELSE 'in_progress'
           END,
           'migrated_from_concierge_service', true,
           'concierge_service_id', service.id
       ),
       service.created_at
FROM concierge_service_task_backfill_map mapped
JOIN concierge_services service ON service.id = mapped.concierge_service_id
WHERE mapped.created_by_migration;

-- Copy the service facts onto the selected canonical task.  Existing task
-- identity, title, assignee, kind, schedule and workflow status are retained;
-- the exact legacy booking status is preserved separately in service_status.
UPDATE tasks task
SET patient_id = service.patient_id,
    appointment_id = service.appointment_id,
    provider_id = COALESCE(service.provider_id, task.provider_id),
    location = COALESCE(task.location, service.service_address),
    service_kind = service.service_kind,
    service_status = service.status,
    provider_service_id = service.provider_service_id,
    taxonomy_node_id = service.taxonomy_node_id,
    request_source = service.request_source,
    booking_reference = service.booking_reference,
    vendor_name = service.vendor_name,
    vendor_contact = service.vendor_contact,
    service_address = service.service_address,
    quantity = service.quantity,
    unit_price = service.unit_price,
    currency = CASE
        WHEN upper(btrim(service.currency)) ~ '^[A-Z]{3}$'
        THEN upper(btrim(service.currency))
        ELSE 'EUR'
    END,
    cost_estimate = service.cost_estimate,
    actual_cost = service.actual_cost,
    billing_status = service.billing_status,
    service_notes = service.service_notes,
    billing_notes = service.billing_notes,
    completed_at = COALESCE(task.completed_at, service.completed_at),
    billed_at = service.billed_at,
    key_status = service.key_status,
    key_responsible_user_id = service.key_responsible_user_id,
    key_status_at = service.key_status_at
FROM concierge_service_task_backfill_map mapped
JOIN concierge_services service ON service.id = mapped.concierge_service_id
WHERE task.id = mapped.task_id;

ALTER TABLE concierge_service_partner_interactions
    ADD COLUMN task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT;
ALTER TABLE concierge_service_cost_estimate_decisions
    ADD COLUMN task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT;
ALTER TABLE concierge_service_key_events
    ADD COLUMN task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT;
ALTER TABLE concierge_expense_submissions
    ADD COLUMN task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT;

UPDATE concierge_service_partner_interactions interaction
SET task_id = mapped.task_id
FROM concierge_service_task_backfill_map mapped
WHERE interaction.concierge_service_id = mapped.concierge_service_id;

UPDATE concierge_service_cost_estimate_decisions decision
SET task_id = mapped.task_id
FROM concierge_service_task_backfill_map mapped
WHERE decision.concierge_service_id = mapped.concierge_service_id;

UPDATE concierge_service_key_events key_event
SET task_id = mapped.task_id
FROM concierge_service_task_backfill_map mapped
WHERE key_event.concierge_service_id = mapped.concierge_service_id;

-- Expense submissions are append-only at runtime.  Temporarily remove only the
-- mutation trigger while adding their canonical relationship, then restore it
-- before the migration completes.
DROP TRIGGER protect_concierge_expense_submission_trigger
    ON concierge_expense_submissions;

UPDATE concierge_expense_submissions submission
SET task_id = mapped.task_id
FROM concierge_service_task_backfill_map mapped
WHERE submission.concierge_service_id = mapped.concierge_service_id;

CREATE TRIGGER protect_concierge_expense_submission_trigger
    BEFORE UPDATE OR DELETE ON concierge_expense_submissions
    FOR EACH ROW EXECUTE FUNCTION protect_concierge_expense_append_only();

ALTER TABLE concierge_service_partner_interactions
    ALTER COLUMN task_id SET NOT NULL,
    ALTER COLUMN concierge_service_id DROP NOT NULL;
ALTER TABLE concierge_service_cost_estimate_decisions
    ALTER COLUMN task_id SET NOT NULL,
    ALTER COLUMN concierge_service_id DROP NOT NULL;
ALTER TABLE concierge_service_key_events
    ALTER COLUMN task_id SET NOT NULL,
    ALTER COLUMN concierge_service_id DROP NOT NULL;
ALTER TABLE concierge_expense_submissions
    ALTER COLUMN task_id SET NOT NULL,
    ALTER COLUMN concierge_service_id DROP NOT NULL;

CREATE INDEX idx_concierge_partner_interactions_task_time
    ON concierge_service_partner_interactions(
        task_id,
        occurred_at DESC,
        created_at DESC
    );
CREATE UNIQUE INDEX uq_concierge_partner_interactions_task_request
    ON concierge_service_partner_interactions(task_id, request_id);

CREATE INDEX idx_concierge_cost_estimate_decisions_task
    ON concierge_service_cost_estimate_decisions(task_id, applied_at DESC);

CREATE INDEX idx_concierge_key_events_task_time
    ON concierge_service_key_events(task_id, occurred_at DESC, created_at DESC);

CREATE INDEX idx_concierge_expense_submissions_task
    ON concierge_expense_submissions(task_id, created_at DESC);
CREATE UNIQUE INDEX uq_concierge_expense_task_request
    ON concierge_expense_submissions(task_id, request_id);
CREATE UNIQUE INDEX uq_concierge_expense_task_receipt
    ON concierge_expense_submissions(task_id, receipt_sha256)
    WHERE receipt_sha256 IS NOT NULL;

-- New submissions are validated against their canonical task.  The optional
-- legacy service is checked only when supplied, so task-native expenses do not
-- need a synthetic concierge_services row.
CREATE OR REPLACE FUNCTION validate_concierge_expense_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    task_patient UUID;
    task_currency TEXT;
    task_service UUID;
    service_patient UUID;
    order_patient UUID;
    order_currency TEXT;
    leistung_order UUID;
    leistung_currency TEXT;
    document_patient UUID;
    document_order UUID;
    document_visibility TEXT;
    document_is_medical BOOLEAN;
BEGIN
    SELECT patient_id, currency, concierge_service_id
    INTO task_patient, task_currency, task_service
    FROM tasks
    WHERE id = NEW.task_id
    FOR UPDATE;

    IF task_patient IS NULL OR NEW.patient_id <> task_patient THEN
        RAISE EXCEPTION 'concierge expense patient and task must match';
    END IF;
    IF NEW.currency <> task_currency THEN
        RAISE EXCEPTION 'concierge expense currency must match the task';
    END IF;

    IF NEW.concierge_service_id IS NOT NULL THEN
        SELECT patient_id
        INTO service_patient
        FROM concierge_services
        WHERE id = NEW.concierge_service_id
        FOR UPDATE;

        IF service_patient IS NULL
           OR NEW.patient_id <> service_patient
           OR task_service IS DISTINCT FROM NEW.concierge_service_id
        THEN
            RAISE EXCEPTION 'concierge expense task and legacy service must match';
        END IF;
    END IF;

    IF NEW.order_id IS NOT NULL THEN
        SELECT patient_id, upper(currency)
        INTO order_patient, order_currency
        FROM orders
        WHERE id = NEW.order_id
        FOR UPDATE;
        IF order_patient IS NULL OR NEW.patient_id <> order_patient THEN
            RAISE EXCEPTION 'concierge expense order must belong to the same patient';
        END IF;
        IF order_currency <> NEW.currency THEN
            RAISE EXCEPTION 'concierge expense currency must match the order';
        END IF;
    END IF;

    IF NEW.order_leistung_id IS NOT NULL THEN
        SELECT order_id, upper(currency)
        INTO leistung_order, leistung_currency
        FROM order_leistungen
        WHERE id = NEW.order_leistung_id
        FOR UPDATE;
        IF leistung_order IS NULL
           OR leistung_order <> NEW.order_id
           OR leistung_currency <> NEW.currency
        THEN
            RAISE EXCEPTION 'concierge expense service line must match order and currency';
        END IF;
    END IF;

    IF NEW.receipt_document_id IS NOT NULL THEN
        SELECT patient_id, order_id, visibility, is_medical
        INTO document_patient, document_order, document_visibility, document_is_medical
        FROM documents
        WHERE id = NEW.receipt_document_id
        FOR UPDATE;
        IF document_patient IS NULL
           OR document_patient <> NEW.patient_id
           OR document_order IS DISTINCT FROM NEW.order_id
           OR document_visibility <> 'internal'
           OR document_is_medical
        THEN
            RAISE EXCEPTION 'receipt document must be internal, non-medical, and bound to the same patient and order';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON COLUMN concierge_service_partner_interactions.task_id IS
    'Canonical task/event owner; concierge_service_id is transitional legacy provenance.';
COMMENT ON COLUMN concierge_service_cost_estimate_decisions.task_id IS
    'Canonical task/event owner; concierge_service_id is transitional legacy provenance.';
COMMENT ON COLUMN concierge_service_key_events.task_id IS
    'Canonical task/event owner; concierge_service_id is transitional legacy provenance.';
COMMENT ON COLUMN concierge_expense_submissions.task_id IS
    'Canonical task/event owner used by booking and finance validation.';
