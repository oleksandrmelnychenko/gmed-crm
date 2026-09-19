-- Follow-up milestones were recognised only by the appointment title; give
-- them an explicit type so renaming a visit cannot hide it from the plan.
ALTER TABLE appointments
    ADD COLUMN followup_milestone TEXT
        CHECK (followup_milestone IN ('post_1w', 'post_1m', 'post_6m', 'doctor', 'package_end'));

UPDATE appointments SET followup_milestone = CASE
    WHEN title ILIKE '1-week follow-up check-in%' OR title ILIKE 'Контроль%1 неделю%' OR title ILIKE 'Nachsorge nach 1 Woche%' THEN 'post_1w'
    WHEN title ILIKE '1-month follow-up check-in%' OR title ILIKE 'Контроль%1 месяц%' OR title ILIKE 'Nachsorge nach 1 Monat%' THEN 'post_1m'
    WHEN title ILIKE '6-month follow-up check-in%' OR title ILIKE 'Контроль%6 месяцев%' OR title ILIKE 'Nachsorge nach 6 Monaten%' THEN 'post_6m'
    WHEN title ILIKE 'Doctor-directed:%' THEN 'doctor'
    WHEN title ILIKE 'Package-end:%' THEN 'package_end'
END
WHERE checklist_phase = 'followup' AND followup_milestone IS NULL;

CREATE INDEX idx_appointments_followup_milestone
    ON appointments (order_id, followup_milestone)
    WHERE followup_milestone IS NOT NULL;
