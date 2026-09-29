-- A recommendation had two independent states: `status` (portal, staff page,
-- patient decisions) and `lifecycle_status` (clinical tab), which could
-- disagree (e.g. "completed" in the portal but "aktiv" clinically). They are
-- now one lifecycle (owner decision 2026-09-28): the server derives one from
-- the other, and this constraint keeps them in step.
--
--   status       lifecycle_status
--   active       aktiv
--   completed    erfolg
--   declined     nicht_erfolgt
--   cancelled    nicht_erfolgt
--   superseded   unbekannt
--
-- One-off reconciliation of existing rows: a clinical outcome recorded on a
-- still-active recommendation wins (erfolg -> completed, nicht_erfolgt ->
-- cancelled, unbekannt -> superseded); otherwise the lifecycle follows the
-- status. Every changed row is audited in this transaction.
WITH reconciled AS (
    SELECT id,
           patient_id,
           status AS previous_status,
           lifecycle_status AS previous_lifecycle_status,
           CASE
               WHEN status = 'active' AND lifecycle_status = 'erfolg' THEN 'completed'
               WHEN status = 'active' AND lifecycle_status = 'nicht_erfolgt' THEN 'cancelled'
               WHEN status = 'active' AND lifecycle_status = 'unbekannt' THEN 'superseded'
               ELSE status
           END AS next_status
    FROM patient_recommendations
),
target AS (
    SELECT reconciled.*,
           CASE next_status
               WHEN 'active' THEN 'aktiv'
               WHEN 'completed' THEN 'erfolg'
               WHEN 'declined' THEN 'nicht_erfolgt'
               WHEN 'cancelled' THEN 'nicht_erfolgt'
               ELSE 'unbekannt'
           END AS next_lifecycle_status
    FROM reconciled
),
changed AS (
    UPDATE patient_recommendations recommendation
    SET status = target.next_status,
        lifecycle_status = target.next_lifecycle_status
    FROM target
    WHERE recommendation.id = target.id
      AND (recommendation.status <> target.next_status
           OR recommendation.lifecycle_status <> target.next_lifecycle_status)
    RETURNING recommendation.id, recommendation.patient_id,
              target.previous_status, target.previous_lifecycle_status,
              target.next_status, target.next_lifecycle_status
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'reconcile_recommendation_lifecycle',
       'patient',
       changed.patient_id,
       jsonb_build_object(
           'status', changed.previous_status,
           'lifecycle_status', changed.previous_lifecycle_status
       ),
       jsonb_build_object(
           'status', changed.next_status,
           'lifecycle_status', changed.next_lifecycle_status
       ),
       jsonb_build_object(
           'recommendation_id', changed.id,
           'repair', '20260928213400_recommendation_status_lifecycle_link'
       )
FROM changed;

ALTER TABLE patient_recommendations
    ADD CONSTRAINT patient_recommendations_status_lifecycle_check
        CHECK (
            (status = 'active' AND lifecycle_status = 'aktiv')
            OR (status = 'completed' AND lifecycle_status = 'erfolg')
            OR (status IN ('declined', 'cancelled') AND lifecycle_status = 'nicht_erfolgt')
            OR (status = 'superseded' AND lifecycle_status = 'unbekannt')
        );
