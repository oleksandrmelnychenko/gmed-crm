ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS date_from DATE,
    ADD COLUMN IF NOT EXISTS date_to DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'orders_service_period_check'
          AND conrelid = 'orders'::regclass
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_service_period_check
            CHECK (date_from IS NULL OR date_to IS NULL OR date_to >= date_from);
    END IF;
END
$$;
