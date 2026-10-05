-- Owner decision 2026-10-05: orders need no manual billing release. Debts, the
-- order signatures (or a covering package) and the payment tracking already
-- decide whether an order may go ahead; the extra "Разрешение бухгалтерии"
-- step only confused. There is no production data worth keeping (owner).
DROP INDEX IF EXISTS idx_orders_billing_release_status;

ALTER TABLE orders
    DROP COLUMN IF EXISTS billing_release_status,
    DROP COLUMN IF EXISTS billing_release_note,
    DROP COLUMN IF EXISTS billing_released_by,
    DROP COLUMN IF EXISTS billing_released_at;
