-- Gapless numbers for invoice correction documents (GoBD): credit notes
-- (Rechnungskorrekturen, `CN-…`) and their reversals (`CNR-…`) share one
-- number range, as they did with `invoice_credit_note_number_seq`; invoice
-- cancellation documents (Stornorechnungen, `STORNO-…`) get their own.
--
-- A sequence burns a value whenever the issuing transaction fails, so numbers
-- are now taken from a counter row that the issuing transaction locks, like
-- invoice numbers at release (`invoice_number_counter`): a failed issue rolls
-- its number back. Existing documents keep their numbers; the credit-note
-- range continues where the sequence stopped.

CREATE TABLE invoice_document_number_counters (
    series TEXT PRIMARY KEY
        CHECK (series IN ('credit_note', 'invoice_storno')),
    last_value BIGINT NOT NULL CHECK (last_value >= 0)
);

INSERT INTO invoice_document_number_counters (series, last_value)
SELECT 'credit_note', CASE WHEN is_called THEN last_value ELSE last_value - 1 END
FROM invoice_credit_note_number_seq;

INSERT INTO invoice_document_number_counters (series, last_value)
VALUES ('invoice_storno', 0);

COMMENT ON TABLE invoice_document_number_counters IS
    'Last issued number per correction document range; the row is locked by the issuing transaction, so the ranges have no gaps.';
COMMENT ON SEQUENCE invoice_credit_note_number_seq IS
    'Superseded by invoice_document_number_counters (series credit_note).';
