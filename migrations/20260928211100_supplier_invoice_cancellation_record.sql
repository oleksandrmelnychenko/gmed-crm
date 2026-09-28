-- Supplier invoices without an order (company costs and patient costs not yet
-- assigned to an order) can now be corrected and cancelled from the incoming
-- invoice register by CEO and billing (owner decision 2026-09-28, status
-- audit Q12). A cancellation keeps who, when and why on the invoice; the audit
-- row is written in the same transaction. Invoices cancelled before keep NULL.
ALTER TABLE external_invoices
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE external_invoices
    DROP CONSTRAINT IF EXISTS external_invoices_cancellation_consistent;
ALTER TABLE external_invoices
    ADD CONSTRAINT external_invoices_cancellation_consistent
    CHECK (cancelled_at IS NULL OR status = 'cancelled');

COMMENT ON COLUMN external_invoices.cancellation_reason IS
    'Why staff cancelled the supplier invoice (3-1000 characters); NULL for older cancellations.';
