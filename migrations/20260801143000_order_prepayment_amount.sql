ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS prepayment_amount NUMERIC;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'orders_prepayment_amount_non_negative'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_prepayment_amount_non_negative
            CHECK (prepayment_amount IS NULL OR prepayment_amount >= 0);
    END IF;
END $$;
