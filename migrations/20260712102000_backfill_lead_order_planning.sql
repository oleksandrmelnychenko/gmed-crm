UPDATE order_planning_preparation AS planning
SET interpreter_required = source.requires_interpreter,
    interpreter_briefing_status = CASE
        WHEN source.requires_interpreter THEN 'pending'
        ELSE planning.interpreter_briefing_status
    END,
    non_medical_required = source.requires_non_medical
FROM (
    SELECT
        orders.id AS order_id,
        COALESCE(leads.needs_interpreter, false)
            OR COALESCE(leads.services, ARRAY[]::text[])
               && ARRAY['interpreter_support']::text[]
            AS requires_interpreter,
        COALESCE(leads.services, ARRAY[]::text[])
            && ARRAY[
                'driver',
                'concierge',
                'concierge_support',
                'medical-transport',
                'medical_transport',
                'air-ambulance',
                'air_ambulance',
                'business-aviation',
                'business_aviation'
            ]::text[]
            AS requires_non_medical
    FROM orders
    JOIN leads ON leads.id = orders.source_lead_id
) AS source
WHERE planning.order_id = source.order_id
  AND planning.updated_at = planning.created_at;
