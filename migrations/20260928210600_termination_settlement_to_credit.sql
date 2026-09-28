-- Accrual follows actual delivery (status audit Q7): a service invoiced in
-- advance but never delivered did not accrue, so the settlement owes what
-- released invoices still bill for it back to the patient (`to_credit_gross`)
-- until a credit note corrects the invoice. The snapshot keeps that amount and
-- the balance arithmetic includes it. Existing settlements have none.

ALTER TABLE order_termination_settlements
    ADD COLUMN IF NOT EXISTS to_credit_gross NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (to_credit_gross >= 0);

ALTER TABLE order_termination_settlements
    DROP CONSTRAINT IF EXISTS order_termination_settlements_arithmetic;
ALTER TABLE order_termination_settlements
    ADD CONSTRAINT order_termination_settlements_arithmetic
    CHECK (balance_gross = invoiced_gross - to_credit_gross + uninvoiced_gross - paid_gross);
