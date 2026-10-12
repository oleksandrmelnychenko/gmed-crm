-- The order in which invoices were released, independent of the clock.
--
-- A final invoice settles only the advance invoices released before it
-- (`routes::invoices::advance_settlement::FINAL_SETTLES_ADVANCE`). Comparing
-- `issued_at` (the `now()` of two different transactions) fails when the
-- database clock steps back between the two releases (seen once in CI under
-- load: the advance was not settled). A sequence value taken when the invoice
-- is released is strictly increasing whatever the clock does.
--
-- Invoices released before this migration keep `release_sequence` NULL (their
-- released rows are not rewritten, GoBD); the rule falls back to `issued_at`
-- when either invoice has none.

CREATE SEQUENCE IF NOT EXISTS invoice_release_sequence;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS release_sequence BIGINT;

COMMENT ON COLUMN invoices.release_sequence IS
    'Release order (invoice_release_sequence), set once when the invoice is released; NULL for invoices released before 2026-10-12';

-- The guard of migration 20260927211200, now also numbering the release
-- order: a released invoice keeps its number, release time and release order
-- and never returns to draft; any write that makes an invoice non-draft marks
-- it released.
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
        IF NEW.release_sequence IS DISTINCT FROM OLD.release_sequence THEN
            RAISE EXCEPTION 'A released invoice keeps its release order'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF NEW.released_at IS NULL AND NEW.status NOT IN ('draft', 'cancelled') THEN
        NEW.released_at := now();
    END IF;

    -- Only at the release itself: an invoice released before this migration
    -- does not get a (later) number when it is paid or reminded.
    IF NEW.released_at IS NOT NULL
        AND (TG_OP = 'INSERT' OR OLD.released_at IS NULL)
    THEN
        NEW.release_sequence := nextval('invoice_release_sequence');
    ELSIF NEW.released_at IS NULL THEN
        NEW.release_sequence := NULL;
    END IF;

    IF NEW.released_at IS NOT NULL AND NEW.invoice_number IS NULL THEN
        RAISE EXCEPTION 'A released invoice needs an invoice number'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
