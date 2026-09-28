-- Appointment reminders are delivered to their recipient as a user
-- notification once their moment (remind_at, a point in time entered as
-- German wall-clock time) has come (owner decision 2026-09-28). sent_at marks
-- the delivery so that every reminder is delivered exactly once; closed
-- reminders are never delivered.
ALTER TABLE reminders
    ADD COLUMN sent_at TIMESTAMPTZ;

CREATE INDEX idx_reminders_due_undelivered
    ON reminders (remind_at)
    WHERE NOT is_completed AND sent_at IS NULL;
