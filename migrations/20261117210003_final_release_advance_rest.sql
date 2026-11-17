-- The release of a final invoice settles its advances (owner 2026-11-17,
-- verify2-A S2-1/S2-3):
--   * the unpaid rest of an advance is closed by a credit note (fix-48);
--   * paid advance money that no VAT category of the final can take is
--     corrected by a credit note on the advance (its VAT share is no longer
--     owed for a service that was not rendered) and the cash is moved to the
--     final as a payment (credit transfer), so the patient pays one amount.
-- The Storno of the final reverses exactly what its release did. These
-- columns name the final whose release issued the credit note or the
-- transfer; they are written in the INSERT and never change (both tables
-- are append-only).

ALTER TABLE invoice_credit_note_transactions
    ADD COLUMN final_release_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT;

ALTER TABLE invoice_credit_transfers
    ADD COLUMN final_release_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT;

CREATE INDEX idx_invoice_credit_notes_final_release
    ON invoice_credit_note_transactions(final_release_invoice_id)
    WHERE final_release_invoice_id IS NOT NULL;

CREATE INDEX idx_invoice_credit_transfers_final_release
    ON invoice_credit_transfers(final_release_invoice_id)
    WHERE final_release_invoice_id IS NOT NULL;

COMMENT ON COLUMN invoice_credit_note_transactions.final_release_invoice_id IS
    'Final invoice whose release issued this credit note on its advance (unpaid or unused rest); its Storno reverses it.';
COMMENT ON COLUMN invoice_credit_transfers.final_release_invoice_id IS
    'Final invoice whose release moved the unused paid advance rest onto it as a payment; its Storno reverses it.';
