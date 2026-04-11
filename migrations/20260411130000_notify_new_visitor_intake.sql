-- Fan out an in-app notification to managers / sales / CEO when a new
-- visitor intake lands from the public wizard. Mirrors notify_new_lead.

CREATE OR REPLACE FUNCTION notify_new_visitor_intake() RETURNS trigger AS $$
BEGIN
    INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
    SELECT u.id,
           'new_visitor_intake',
           'New wizard submission: ' || NEW.first_name || ' ' || NEW.last_name,
           trim(both ' ' FROM
               COALESCE(NEW.flow, '') ||
               CASE WHEN NEW.country IS NOT NULL THEN ' · ' || NEW.country ELSE '' END ||
               CASE WHEN NEW.email IS NOT NULL THEN ' · ' || NEW.email ELSE '' END
           ),
           'visitor_intake',
           NEW.id
    FROM users u
    WHERE u.is_active = true
      AND u.role IN ('patient_manager', 'sales', 'ceo');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_new_visitor_intake
    AFTER INSERT ON visitor_intakes
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_visitor_intake();
