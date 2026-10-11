-- Notifications in the viewer's language (QA 2026-10-11, A-23/E-16/E-33).
-- `kind` stays the stable code of a notification; `params` carries its facts
-- (names, dates, counts, status codes) so the staff and patient UI word it in
-- RU or DE (`frontend/src/lib/notification-copy.ts`). `title` and `body` keep
-- an English fallback for rows written before this column and for logs.
ALTER TABLE user_notifications
    ADD COLUMN IF NOT EXISTS params JSONB;

-- The new-lead notice is written by a trigger: its facts are the lead's name
-- and the source code ("manual", "website", ...), translated in the UI.
CREATE OR REPLACE FUNCTION notify_new_lead() RETURNS trigger AS $$
BEGIN
    INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id, params)
    SELECT u.id, 'new_lead',
           'New lead: ' || NEW.first_name || ' ' || NEW.last_name,
           coalesce(NEW.source, ''),
           'lead', NEW.id,
           jsonb_build_object(
               'lead_name', btrim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')),
               'source', NEW.source
           )
    FROM users u
    WHERE u.is_active = true AND u.role IN ('patient_manager', 'sales', 'ceo');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
