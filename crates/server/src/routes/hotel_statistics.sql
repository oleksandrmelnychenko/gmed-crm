WITH bookings AS (
    SELECT 'service'::text AS source, cs.id, cs.id AS service_id, linked.id AS task_id,
           CASE WHEN linked.service_kind IS NULL THEN cs.patient_id ELSE linked.patient_id END AS patient_id,
           CASE WHEN linked.service_kind IS NULL THEN cs.booking_reference ELSE linked.booking_reference END AS booking_reference,
           CASE WHEN linked.service_kind IS NULL THEN cs.provider_id ELSE linked.provider_id END AS provider_id,
           CASE WHEN linked.service_kind IS NULL THEN cs.vendor_name ELSE linked.vendor_name END AS vendor_name,
           COALESCE(linked.service_status, cs.status) AS status,
           CASE WHEN linked.service_kind IS NULL THEN cs.starts_at ELSE linked.starts_at END AS starts_at,
           CASE WHEN linked.service_kind IS NULL THEN cs.ends_at ELSE linked.ends_at END AS ends_at,
           CASE WHEN linked.service_kind IS NULL THEN cs.actual_cost ELSE linked.actual_cost END AS actual_cost,
           CASE WHEN linked.service_kind IS NULL THEN cs.cost_estimate ELSE linked.cost_estimate END AS cost_estimate,
           CASE WHEN linked.service_kind IS NULL THEN cs.currency ELSE linked.currency END AS currency
    FROM concierge_services cs
    LEFT JOIN LATERAL (
        SELECT task.* FROM tasks task
        WHERE task.concierge_service_id = cs.id
        ORDER BY (task.service_kind IS NOT NULL) DESC, (task.deleted_at IS NULL) DESC,
                 (task.task_scope = 'concierge_operational') DESC, task.created_at, task.id LIMIT 1
    ) linked ON true
    WHERE COALESCE(linked.service_kind, cs.service_kind) = 'hotel'
      AND linked.deleted_at IS NULL
      AND (CASE WHEN linked.service_kind IS NULL THEN cs.patient_id ELSE linked.patient_id END) IS NOT NULL
      AND (linked.id IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM tasks task WHERE task.concierge_service_id = cs.id
      ))
    UNION ALL
    SELECT 'task', task.id, NULL::uuid, task.id, task.patient_id, task.booking_reference, task.provider_id,
           task.vendor_name, COALESCE(task.service_status, 'planned'),
           task.starts_at, task.ends_at, task.actual_cost, task.cost_estimate, task.currency
    FROM tasks task
    WHERE task.concierge_service_id IS NULL AND task.service_kind = 'hotel'
      AND task.deleted_at IS NULL AND task.patient_id IS NOT NULL
), scoped AS (
    SELECT booking.*,
           (starts_at AT TIME ZONE 'Europe/Berlin')::date AS check_in,
           (ends_at AT TIME ZONE 'Europe/Berlin')::date AS check_out
    FROM bookings booking
    WHERE ($3 OR EXISTS (
        SELECT 1 FROM patient_assignments assignment
        WHERE assignment.patient_id = booking.patient_id
          AND assignment.user_id = $4 AND assignment.revoked_at IS NULL
    ))
      AND (starts_at IS NULL OR (starts_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN $1 AND $2)
)
SELECT jsonb_build_object(
    'id', booking.id, 'source', booking.source, 'task_id', booking.task_id,
    'patient_id', booking.patient_id, 'provider_id', booking.provider_id,
    'patient_name', NULLIF(btrim(concat_ws(' ', patient.first_name, patient.last_name)), ''),
    'patient_number', patient.patient_id, 'booking_reference', booking.booking_reference,
    'hotel_name', COALESCE(provider.name, NULLIF(btrim(booking.vendor_name), '')),
    'city', provider.address_city, 'status', booking.status,
    'check_in', booking.check_in, 'check_out', booking.check_out,
    'room_count', details.room_count, 'details_updated_at', details.updated_at,
    'breakfast_mode', COALESCE(details.breakfast_mode, 'unknown'),
    'breakfast_count', details.breakfast_count, 'breakfast_total', details.breakfast_total::text,
    'breakfast_currency', details.breakfast_currency,
    'breakfast_payer', COALESCE(details.breakfast_payer, 'unknown'), 'breakfast_notes', details.breakfast_notes,
    'currency', upper(booking.currency),
    'actual_cost', booking.actual_cost::text, 'cost_estimate', booking.cost_estimate::text,
    'posted_cost', finance.posted_cost::text, 'posted_count', finance.posted_count,
    'direct_paid', finance.direct_paid::text, 'company_paid', finance.company_paid::text,
    'provider_due', finance.provider_due::text, 'pending_cost', finance.pending_cost::text,
    'pending_count', finance.pending_count
) AS item
FROM scoped booking
LEFT JOIN patients patient ON patient.id = booking.patient_id
LEFT JOIN providers provider ON provider.id = booking.provider_id
LEFT JOIN hotel_stay_statistics_details details
  ON (booking.source = 'service' AND details.concierge_service_id = booking.id)
  OR (booking.source = 'task' AND details.task_id = booking.id)
LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE review.action = 'posted' AND reversal.id IS NULL) AS posted_count,
           COALESCE(sum(submission.amount_gross) FILTER (WHERE review.action = 'posted' AND reversal.id IS NULL), 0) AS posted_cost,
           COALESCE(sum(submission.amount_gross) FILTER (WHERE review.action = 'posted' AND reversal.id IS NULL AND external.paid_by = 'patient'), 0) AS direct_paid,
           COALESCE(sum(settlement.company_paid_gross) FILTER (WHERE review.action = 'posted' AND reversal.id IS NULL), 0) AS company_paid,
           COALESCE(sum(COALESCE(settlement.remaining_provider_liability_gross, external.provider_liability_gross)) FILTER (WHERE review.action = 'posted' AND reversal.id IS NULL), 0) AS provider_due,
           COALESCE(sum(submission.amount_gross) FILTER (WHERE review.id IS NULL), 0) AS pending_cost,
           count(*) FILTER (WHERE review.id IS NULL) AS pending_count
    FROM concierge_expense_submissions submission
    LEFT JOIN concierge_expense_review_events review
      ON review.expense_id = submission.id AND review.action IN ('posted', 'rejected')
    LEFT JOIN concierge_expense_review_events reversal
      ON reversal.reverses_event_id = review.id AND reversal.action = 'reversed'
    LEFT JOIN external_invoices external ON external.id = review.external_invoice_id
    LEFT JOIN external_invoice_provider_settlement_balances settlement ON settlement.external_invoice_id = external.id
    WHERE upper(submission.currency) = upper(booking.currency)
      AND ((booking.source = 'task' AND submission.task_id = booking.id)
        OR (booking.source = 'service' AND (submission.concierge_service_id = booking.id
          OR EXISTS (SELECT 1 FROM tasks task WHERE task.id = submission.task_id AND task.concierge_service_id = booking.id))))
) finance ON true
ORDER BY booking.check_in DESC NULLS LAST, booking.id
