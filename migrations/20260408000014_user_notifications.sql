CREATE TABLE IF NOT EXISTS user_notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    entity_type TEXT,
    entity_id   UUID,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_notif_user ON user_notifications(user_id, is_read) WHERE NOT is_read;

CREATE OR REPLACE FUNCTION notify_new_lead() RETURNS trigger AS $$
BEGIN
    INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
    SELECT u.id, 'new_lead',
           'New lead: ' || NEW.first_name || ' ' || NEW.last_name,
           coalesce(NEW.source, ''),
           'lead', NEW.id
    FROM users u
    WHERE u.is_active = true AND u.role IN ('patient_manager', 'sales', 'ceo');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_new_lead
    AFTER INSERT ON leads
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_lead();
