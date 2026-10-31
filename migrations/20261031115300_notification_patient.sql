-- QA 2026-10-31 (R2-C): a parent with two children saw the notices of both,
-- whichever child was selected. Which patient a notification belongs to, read
-- from the record it points at; NULL for a notice about no patient (it shows
-- for every selection).
CREATE OR REPLACE FUNCTION user_notification_patient(kind_of_entity TEXT, target UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT CASE kind_of_entity
        WHEN 'patient' THEN target
        WHEN 'recommendation' THEN (SELECT patient_id FROM patient_recommendations WHERE id = target)
        WHEN 'appointment' THEN (SELECT patient_id FROM appointments WHERE id = target)
        WHEN 'appointment_request' THEN (SELECT patient_id FROM patient_appointment_requests WHERE id = target)
        WHEN 'document' THEN (SELECT patient_id FROM documents WHERE id = target)
        WHEN 'invoice' THEN (SELECT patient_id FROM invoices WHERE id = target)
        WHEN 'order' THEN (SELECT patient_id FROM orders WHERE id = target)
        WHEN 'case' THEN (SELECT patient_id FROM cases WHERE id = target)
    END
$$;
