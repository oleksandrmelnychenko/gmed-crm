-- QA 2026-10-31 (R4-1, R3-6): an order cancelled by hand left delivered work
-- unbillable and a paid advance without a settlement record, though the doc
-- (section 7) gives it the same rule as a contract termination. It gets the
-- same settlement now; such an order need not have a framework contract.
ALTER TABLE order_termination_settlements
    ALTER COLUMN contract_id DROP NOT NULL;

COMMENT ON TABLE order_termination_settlements IS
    'Final settlement of an order stopped by framework contract termination or cancelled by hand; amounts are the snapshot at that moment.';
