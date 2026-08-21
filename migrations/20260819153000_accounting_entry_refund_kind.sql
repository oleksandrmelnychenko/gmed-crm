-- Refund accounting entries are signed cash movements in the same append-only
-- ledger. The original 2026-04 constraint predates the refund journal.

ALTER TABLE accounting_entries
    DROP CONSTRAINT IF EXISTS accounting_entries_entry_kind_check;

ALTER TABLE accounting_entries
    ADD CONSTRAINT accounting_entries_entry_kind_check CHECK (
        entry_kind IN (
            'invoice_payment',
            'invoice_refund',
            'external_invoice_payment'
        )
    );

