-- Editing a recorded payment keeps the journal append-only: the original receipt
-- is reversed and a corrected receipt is appended in the same transaction.
-- corrects_transaction_id links the corrected receipt back to the one it replaces.

ALTER TABLE invoice_payment_transactions
    ADD COLUMN corrects_transaction_id UUID
        REFERENCES invoice_payment_transactions(id) ON DELETE RESTRICT,
    ADD CONSTRAINT invoice_payment_transaction_correction_shape CHECK (
        corrects_transaction_id IS NULL OR transaction_type = 'payment'
    );

CREATE UNIQUE INDEX uq_invoice_payment_transaction_correction
    ON invoice_payment_transactions(corrects_transaction_id)
    WHERE corrects_transaction_id IS NOT NULL;

COMMENT ON COLUMN invoice_payment_transactions.corrects_transaction_id IS
    'Receipt replaced by this corrected receipt; the replaced receipt carries a reversal row.';
