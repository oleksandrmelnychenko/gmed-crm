WITH booking AS (
    SELECT cs.id, CASE WHEN linked.service_kind IS NULL THEN cs.patient_id ELSE linked.patient_id END AS patient_id,
           CASE WHEN linked.service_kind IS NULL THEN cs.currency ELSE linked.currency END AS currency
    FROM concierge_services cs
    LEFT JOIN LATERAL (
        SELECT task.* FROM tasks task WHERE task.concierge_service_id = cs.id
        ORDER BY (task.service_kind IS NOT NULL) DESC, (task.deleted_at IS NULL) DESC,
                 (task.task_scope = 'concierge_operational') DESC, task.created_at, task.id LIMIT 1
    ) linked ON true
    WHERE $1 = 'service' AND cs.id = $2 AND COALESCE(linked.service_kind, cs.service_kind) = 'hotel'
      AND linked.deleted_at IS NULL
      AND (CASE WHEN linked.service_kind IS NULL THEN cs.patient_id ELSE linked.patient_id END) IS NOT NULL
      AND (linked.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM tasks task WHERE task.concierge_service_id = cs.id))
    UNION ALL
    SELECT id, patient_id, currency FROM tasks WHERE $1 = 'task' AND id = $2 AND service_kind = 'hotel'
      AND concierge_service_id IS NULL AND deleted_at IS NULL AND patient_id IS NOT NULL
)
INSERT INTO hotel_stay_statistics_details (
    concierge_service_id, task_id, breakfast_mode, breakfast_count, breakfast_total,
    breakfast_currency, breakfast_payer, breakfast_notes, updated_by
)
SELECT CASE WHEN $1 = 'service' THEN id END, CASE WHEN $1 = 'task' THEN id END,
       $3, $4, $5::text::numeric, $6, $7, $8, $9
FROM booking
WHERE ($10 OR EXISTS (SELECT 1 FROM patient_assignments WHERE patient_id = booking.patient_id AND user_id = $9 AND revoked_at IS NULL))
  AND ($6::text IS NULL OR upper(booking.currency) = $6)
ON CONFLICT (__SOURCE_KEY__) DO UPDATE SET
    breakfast_mode = EXCLUDED.breakfast_mode, breakfast_count = EXCLUDED.breakfast_count,
    breakfast_total = EXCLUDED.breakfast_total, breakfast_currency = EXCLUDED.breakfast_currency,
    breakfast_payer = EXCLUDED.breakfast_payer, breakfast_notes = EXCLUDED.breakfast_notes,
    updated_by = EXCLUDED.updated_by, updated_at = now()
RETURNING id
