-- Termination settlements use the same basis as the patient's account
-- statement: balance = invoiced (after credit notes) + not yet invoiced - paid.
--
-- The snapshot used to require balance = accrued - paid and
-- uninvoiced = accrued - invoiced. Credit notes then reappeared as
-- "not invoiced" and invoice lines that billed nothing accrued (or legacy
-- quote lines without a service link) made the two differ from what "create
-- final invoice" billed. `uninvoiced_gross` is now determined line by line
-- (services not on any invoice yet, third-party costs still to re-invoice and
-- draft invoices). Existing snapshots satisfy the new identity as well:
-- invoiced + (accrued - invoiced) - paid = accrued - paid.

ALTER TABLE order_termination_settlements
    DROP CONSTRAINT IF EXISTS order_termination_settlements_arithmetic;
ALTER TABLE order_termination_settlements
    ADD CONSTRAINT order_termination_settlements_arithmetic
    CHECK (balance_gross = invoiced_gross + uninvoiced_gross - paid_gross);

COMMENT ON COLUMN order_termination_settlements.uninvoiced_gross IS
    'Accrued but not on a released invoice at termination: uninvoiced service quantities, third-party costs still to re-invoice and draft invoices.';
COMMENT ON COLUMN order_termination_settlements.balance_gross IS
    'invoiced_gross + uninvoiced_gross - paid_gross at termination (positive: the patient owes, negative: refund due).';
