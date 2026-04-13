ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS recurrence_parent_series_id UUID REFERENCES appointments(id),
    ADD COLUMN IF NOT EXISTS recurrence_split_from_appointment_id UUID REFERENCES appointments(id),
    ADD COLUMN IF NOT EXISTS recurrence_split_from_index INT;

CREATE INDEX IF NOT EXISTS idx_apt_recurrence_parent_series_id
    ON appointments(recurrence_parent_series_id)
    WHERE recurrence_parent_series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_apt_recurrence_split_from_appointment_id
    ON appointments(recurrence_split_from_appointment_id)
    WHERE recurrence_split_from_appointment_id IS NOT NULL;
