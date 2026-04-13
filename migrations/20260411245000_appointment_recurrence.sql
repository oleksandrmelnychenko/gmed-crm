ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS recurrence_series_id UUID REFERENCES appointments(id),
    ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT,
    ADD COLUMN IF NOT EXISTS recurrence_interval INT,
    ADD COLUMN IF NOT EXISTS recurrence_count INT,
    ADD COLUMN IF NOT EXISTS recurrence_until DATE,
    ADD COLUMN IF NOT EXISTS recurrence_index INT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_recurrence_frequency_check'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_recurrence_frequency_check
            CHECK (
                recurrence_frequency IS NULL
                OR recurrence_frequency IN ('daily', 'weekly', 'monthly')
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_recurrence_interval_check'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_recurrence_interval_check
            CHECK (recurrence_interval IS NULL OR recurrence_interval > 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_recurrence_count_check'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_recurrence_count_check
            CHECK (recurrence_count IS NULL OR recurrence_count > 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_recurrence_index_check'
    ) THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_recurrence_index_check
            CHECK (recurrence_index >= 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_apt_recurrence_series
    ON appointments(recurrence_series_id);
