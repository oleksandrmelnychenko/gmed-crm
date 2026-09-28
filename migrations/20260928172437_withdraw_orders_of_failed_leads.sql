-- One-off repair: a lead opens its order as soon as staff start the intake
-- wizard (the preparation order: source_lead_id set, no patient yet, or the
-- draft of a repeat intake). Until 2026-09-28 archiving or deleting a failed
-- lead left that order active, so /orders listed active orders of leads that
-- no longer exist for the business (QA A-19). The failed-lead workflow now
-- withdraws the order in its own transaction
-- (crates/server/src/routes/orders.rs, withdraw_lead_orders_in_tx) with the
-- reserved reason 'lead_archived' or 'lead_deleted'; returning an archived
-- lead to work reopens the 'lead_archived' order. This applies the same to
-- the preparation orders of leads that failed before.
--
-- Like an order cancellation, the order's planned services are cancelled and
-- its open quotes closed ('rejected'). An order with an invoice (patient or
-- supplier, even a draft) is left alone: it needs a decision in the order
-- card, not a silent cancellation. The cancellation is recorded as made by
-- the user who closed the lead and at that moment (failed_processed_by /
-- failed_processed_at), so a later "return to work" reopens it exactly like a
-- current one; without a recorded user the service lines keep empty
-- cancellation columns (as after a contract termination) and quote snapshots
-- are skipped.
--
-- Every changed order and quote is audited in the same transaction; the
-- audit row has no acting user because the migration, not a person, made the
-- change. Nothing is deleted.

CREATE TEMP TABLE failed_lead_orders ON COMMIT DROP AS
SELECT order_record.id AS order_id,
       order_record.status AS previous_status,
       order_record.phase,
       lead.id AS lead_id,
       CASE WHEN lead.failed_outcome_status = 'archived' THEN 'lead_archived'
            ELSE 'lead_deleted' END AS reason,
       COALESCE(lead.failed_processed_at, now()) AS cancelled_at,
       lead.failed_processed_by AS cancelled_by
FROM orders order_record
JOIN leads lead ON lead.id = order_record.source_lead_id
WHERE order_record.status IN ('active', 'paused')
  AND (order_record.patient_id IS NULL OR order_record.intake_state = 'draft')
  AND lead.converted_patient_id IS NULL
  AND lead.failed_outcome_status IN ('archived', 'delete_anonymized')
  AND NOT EXISTS (
      SELECT 1 FROM invoices invoice
      WHERE invoice.order_id = order_record.id AND invoice.status <> 'cancelled'
  )
  AND NOT EXISTS (
      SELECT 1 FROM external_invoices external
      WHERE external.order_id = order_record.id AND external.status <> 'cancelled'
  );

CREATE TEMP TABLE failed_lead_order_services (
    id UUID NOT NULL,
    order_id UUID NOT NULL
) ON COMMIT DROP;

WITH cancelled AS (
    UPDATE order_leistungen service
    SET status = 'cancelled',
        cancelled_at = CASE WHEN candidate.cancelled_by IS NULL THEN NULL
                            ELSE candidate.cancelled_at END,
        cancelled_by = candidate.cancelled_by,
        cancellation_reason = CASE WHEN candidate.cancelled_by IS NULL THEN NULL
                                   ELSE candidate.reason END
    FROM failed_lead_orders candidate
    WHERE service.order_id = candidate.order_id
      AND service.status = 'planned'
    RETURNING service.id, service.order_id
)
INSERT INTO failed_lead_order_services (id, order_id)
SELECT id, order_id FROM cancelled;

CREATE TEMP TABLE failed_lead_order_quotes (
    id UUID NOT NULL,
    order_id UUID NOT NULL,
    quote_number TEXT NOT NULL,
    previous_status TEXT NOT NULL
) ON COMMIT DROP;

WITH closed AS (
    UPDATE quotes quote
    SET status = 'rejected'
    FROM quotes previous, failed_lead_orders candidate
    WHERE previous.id = quote.id
      AND quote.order_id = candidate.order_id
      AND quote.status NOT IN ('rejected', 'expired', 'superseded')
      AND NOT EXISTS (
          SELECT 1 FROM invoices final_invoice
          WHERE final_invoice.quote_id = quote.id
            AND final_invoice.invoice_type = 'final'
            AND final_invoice.status <> 'cancelled'
      )
    RETURNING quote.id, quote.order_id, quote.quote_number, previous.status AS previous_status
)
INSERT INTO failed_lead_order_quotes (id, order_id, quote_number, previous_status)
SELECT id, order_id, quote_number, previous_status FROM closed;

INSERT INTO quote_versions (
    quote_id, version_number, order_id, quote_number, status,
    total_net, total_vat, total_gross, valid_until, paid_amount, paid_at,
    line_items, notes, change_reason, created_by
)
SELECT quote.id,
       COALESCE((SELECT MAX(version.version_number)
                 FROM quote_versions version
                 WHERE version.quote_id = quote.id), 0) + 1,
       quote.order_id, quote.quote_number, 'rejected',
       quote.total_net, quote.total_vat, quote.total_gross, quote.valid_until,
       order_recorded_cash_paid(quote.order_id),
       order_recorded_cash_received_at(quote.order_id),
       quote.line_items, quote.notes, 'order_cancelled', candidate.cancelled_by
FROM failed_lead_order_quotes closed
JOIN quotes quote ON quote.id = closed.id
JOIN failed_lead_orders candidate ON candidate.order_id = closed.order_id
WHERE candidate.cancelled_by IS NOT NULL;

WITH cancelled AS (
    UPDATE orders order_record
    SET status = 'cancelled',
        cancelled_at = candidate.cancelled_at,
        cancelled_by = candidate.cancelled_by,
        cancellation_reason = candidate.reason,
        total_estimated = COALESCE(order_service_total_gross(order_record.id),
                                   order_record.total_estimated)
    FROM failed_lead_orders candidate
    WHERE order_record.id = candidate.order_id
    RETURNING order_record.id, candidate.previous_status, candidate.phase,
              candidate.lead_id, candidate.reason, candidate.cancelled_at,
              candidate.cancelled_by
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'cancel_order',
       'order',
       cancelled.id,
       jsonb_build_object('status', cancelled.previous_status),
       jsonb_build_object('status', 'cancelled', 'cancellation_reason', cancelled.reason),
       jsonb_build_object(
           'phase', cancelled.phase,
           'source_lead_id', cancelled.lead_id,
           'cancelled_at', cancelled.cancelled_at,
           'cancelled_by', cancelled.cancelled_by,
           'cancelled_service_ids', COALESCE((
               SELECT jsonb_agg(service.id ORDER BY service.id)
               FROM failed_lead_order_services service
               WHERE service.order_id = cancelled.id
           ), '[]'::jsonb),
           'closed_quote_ids', COALESCE((
               SELECT jsonb_agg(quote.id ORDER BY quote.id)
               FROM failed_lead_order_quotes quote
               WHERE quote.order_id = cancelled.id
           ), '[]'::jsonb),
           'reason', 'failed_lead_order_withdrawal',
           'repair', '20260928172437_withdraw_orders_of_failed_leads'
       )
FROM cancelled;

INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'close_quote_for_cancelled_order',
       'quote',
       closed.id,
       jsonb_build_object('status', closed.previous_status),
       jsonb_build_object('status', 'rejected'),
       jsonb_build_object(
           'quote_number', closed.quote_number,
           'order_id', closed.order_id,
           'source_lead_id', candidate.lead_id,
           'reason', 'failed_lead_order_withdrawal',
           'repair', '20260928172437_withdraw_orders_of_failed_leads'
       )
FROM failed_lead_order_quotes closed
JOIN failed_lead_orders candidate ON candidate.order_id = closed.order_id;
