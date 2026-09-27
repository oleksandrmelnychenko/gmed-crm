-- Invoices get their number when they are released, not when a draft is
-- prepared (§ 14 Abs. 4 Nr. 4 UStG, GoBD). A draft that is never issued
-- therefore leaves no hole in the number sequence, and `released_at` marks
-- the invoices that were issued (the patient portal shows only those).

ALTER TABLE invoices ALTER COLUMN invoice_number DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- Existing invoices keep their numbers, including numbered drafts. Everything
-- outside draft was issued; a cancelled invoice counts as issued only with
-- evidence that it left draft (a status change, dunning, payments or credit
-- notes). A draft cancelled before release stays unreleased.
UPDATE invoices
SET released_at = issued_at
WHERE released_at IS NULL
  AND status NOT IN ('draft', 'cancelled');

UPDATE invoices invoice
SET released_at = invoice.issued_at
WHERE invoice.released_at IS NULL
  AND invoice.status = 'cancelled'
  AND (
      EXISTS (
          SELECT 1 FROM audit_log entry
          WHERE entry.entity_type = 'invoice'
            AND entry.entity_id = invoice.id
            AND (
                entry.action = 'auto_mark_invoice_overdue'
                OR (
                    entry.action = 'update_invoice_status'
                    AND entry.context ->> 'status' IN ('sent', 'partially_paid', 'paid', 'overdue')
                )
            )
      )
      OR EXISTS (SELECT 1 FROM invoice_dunning_events dunning WHERE dunning.invoice_id = invoice.id)
      OR EXISTS (SELECT 1 FROM invoice_payment_transactions payment WHERE payment.invoice_id = invoice.id)
      OR EXISTS (SELECT 1 FROM invoice_credit_note_transactions credit WHERE credit.invoice_id = invoice.id)
  );

CREATE INDEX IF NOT EXISTS idx_invoices_patient_released
    ON invoices(patient_id, released_at)
    WHERE released_at IS NOT NULL;

-- Gapless invoice numbers: the counter row is locked by the releasing
-- transaction, so a failed release rolls its number back instead of burning a
-- sequence value. It continues where the old per-draft sequence stopped.
CREATE TABLE invoice_number_counter (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    last_value BIGINT NOT NULL CHECK (last_value >= 0)
);

INSERT INTO invoice_number_counter (singleton, last_value)
SELECT true, CASE WHEN is_called THEN last_value ELSE last_value - 1 END
FROM invoice_number_seq;

COMMENT ON SEQUENCE invoice_number_seq IS
    'Superseded by invoice_number_counter (numbers are assigned at release).';

-- A released invoice keeps its number and release time and never returns to
-- draft; any write that makes an invoice non-draft marks it released.
CREATE OR REPLACE FUNCTION invoices_release_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.released_at IS NOT NULL THEN
        IF NEW.released_at IS DISTINCT FROM OLD.released_at THEN
            RAISE EXCEPTION 'A released invoice keeps its release time'
                USING ERRCODE = 'P0001';
        END IF;
        IF NEW.status = 'draft' THEN
            RAISE EXCEPTION 'A released invoice cannot return to draft'
                USING ERRCODE = 'P0001';
        END IF;
        IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
            RAISE EXCEPTION 'A released invoice keeps its invoice number'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF NEW.released_at IS NULL AND NEW.status NOT IN ('draft', 'cancelled') THEN
        NEW.released_at := now();
    END IF;

    IF NEW.released_at IS NOT NULL AND NEW.invoice_number IS NULL THEN
        RAISE EXCEPTION 'A released invoice needs an invoice number'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_release_guard
    BEFORE INSERT OR UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION invoices_release_guard();
