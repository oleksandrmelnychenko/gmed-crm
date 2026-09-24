-- The patient may terminate the framework contract at any time (§ 6 of the
-- client template), also while an order is running. Every open order under
-- the contract then stops and receives a final settlement: services actually
-- delivered and expenses incurred are billed, planned services are cancelled.

-- Flat fees that become due in full on termination regardless of delivery
-- (the treatment-organisation Pauschale). Per-doctor items ("1doc") are billed
-- only as delivered.
ALTER TABLE agency_service_catalog
    ADD COLUMN IF NOT EXISTS due_in_full_on_termination BOOLEAN NOT NULL DEFAULT false;

UPDATE agency_service_catalog
SET due_in_full_on_termination = true
WHERE service_key LIKE 'organisation\_treatment%' ESCAPE '\'
  AND service_key NOT LIKE '%1doc%'
  AND NOT due_in_full_on_termination;

COMMENT ON COLUMN agency_service_catalog.due_in_full_on_termination IS
    'Flat fee billed in full when the framework contract is terminated, even if not yet delivered.';

-- Planned services of a terminated order are cancelled, not deleted.
ALTER TABLE order_leistungen
    DROP CONSTRAINT IF EXISTS order_leistungen_status_check;
ALTER TABLE order_leistungen
    ADD CONSTRAINT order_leistungen_status_check
    CHECK (status IN ('planned', 'delivered', 'approved', 'invoiced', 'cancelled'));

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_contract_termination_cancelled;
ALTER TABLE orders
    ADD CONSTRAINT orders_contract_termination_cancelled
    CHECK (cancellation_reason IS DISTINCT FROM 'contract_terminated' OR status = 'cancelled');

CREATE TABLE IF NOT EXISTS order_termination_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    contract_id UUID NOT NULL REFERENCES framework_contracts(id) ON DELETE RESTRICT,
    terminated_at TIMESTAMPTZ NOT NULL,
    currency TEXT NOT NULL,
    accrued_net NUMERIC(12, 2) NOT NULL,
    accrued_gross NUMERIC(12, 2) NOT NULL,
    invoiced_gross NUMERIC(12, 2) NOT NULL,
    paid_gross NUMERIC(12, 2) NOT NULL,
    balance_gross NUMERIC(12, 2) NOT NULL,
    uninvoiced_gross NUMERIC(12, 2) NOT NULL,
    lines JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),
    final_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
    settled_at TIMESTAMPTZ,
    settled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    settlement_note TEXT,
    settlement_forced BOOLEAN NOT NULL DEFAULT false,
    settled_balance_gross NUMERIC(12, 2),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_termination_settlements_lines_array
        CHECK (jsonb_typeof(lines) = 'array'),
    CONSTRAINT order_termination_settlements_arithmetic
        CHECK (balance_gross = accrued_gross - paid_gross
               AND uninvoiced_gross = accrued_gross - invoiced_gross),
    CONSTRAINT order_termination_settlements_settled_consistent
        CHECK ((status = 'settled') = (settled_at IS NOT NULL AND settled_by IS NOT NULL)),
    CONSTRAINT order_termination_settlements_forced_note
        CHECK (NOT settlement_forced OR length(btrim(COALESCE(settlement_note, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS idx_order_termination_settlements_status
    ON order_termination_settlements(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_termination_settlements_patient
    ON order_termination_settlements(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_termination_settlements_contract
    ON order_termination_settlements(contract_id);

COMMENT ON TABLE order_termination_settlements IS
    'Final settlement of an order stopped by framework contract termination; amounts are the snapshot at termination.';
COMMENT ON COLUMN order_termination_settlements.balance_gross IS
    'accrued - paid at termination: positive = patient owes, negative = refund due.';
