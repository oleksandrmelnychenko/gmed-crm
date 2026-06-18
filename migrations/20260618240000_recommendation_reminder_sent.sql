-- Empfehlungen reminder delivery: dedup marker.
--
-- The background reminder scheduler (spawn_recommendation_reminder_scheduler
-- in crates/server/src/routes/patient_recommendations.rs) fires a reminder
-- once per recommendation when it becomes due. Stamping reminder_sent_at on
-- delivery guarantees the reminder never re-fires on the next tick.
--
-- NULL means "not yet sent"; a timestamp means "delivered at this instant".

ALTER TABLE patient_recommendations
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
