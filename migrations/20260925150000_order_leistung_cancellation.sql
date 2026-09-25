-- Staff may cancel a service line that is still planned, e.g. a planned
-- interpreter block whose hours an approved report already billed. The line
-- is kept (not deleted) and records who cancelled it, when and why. Lines
-- cancelled by a contract termination keep these columns empty; the
-- termination settlement is their record.
ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE order_leistungen
    DROP CONSTRAINT IF EXISTS order_leistungen_cancellation_consistent;
ALTER TABLE order_leistungen
    ADD CONSTRAINT order_leistungen_cancellation_consistent
    CHECK (
        (cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
        OR (status = 'cancelled'
            AND cancelled_at IS NOT NULL
            AND cancelled_by IS NOT NULL
            AND length(btrim(COALESCE(cancellation_reason, ''))) > 0)
    );

COMMENT ON COLUMN order_leistungen.cancellation_reason IS
    'Why staff cancelled this planned service line; NULL for lines never cancelled by staff.';
