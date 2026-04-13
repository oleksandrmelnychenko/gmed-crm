CREATE INDEX IF NOT EXISTS idx_apt_recurrence_series_id
    ON appointments(recurrence_series_id)
    WHERE recurrence_series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_apt_type_status_date
    ON appointments(appointment_type, status, date DESC);
