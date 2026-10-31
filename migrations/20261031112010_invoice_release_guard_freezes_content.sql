-- A released invoice is immutable (§ 14 UStG, GoBD): the guard of migration
-- 20261012173000 now also freezes what the document prints. The printed remark
-- stayed editable through the status route, without a guard and without an
-- audit row (QA 2026-10-31). Corrections go through credit notes and Storno,
-- which never touch these columns. Payment state, visibility, the due date of
-- an invoice released without one and the internal note stay writable.

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
        IF NEW.notes IS DISTINCT FROM OLD.notes THEN
            RAISE EXCEPTION 'A released invoice keeps its printed remark'
                USING ERRCODE = 'P0001';
        END IF;
        IF NEW.line_items IS DISTINCT FROM OLD.line_items THEN
            RAISE EXCEPTION 'A released invoice keeps its positions'
                USING ERRCODE = 'P0001';
        END IF;
        IF NEW.total_net IS DISTINCT FROM OLD.total_net
            OR NEW.total_vat IS DISTINCT FROM OLD.total_vat
            OR NEW.total_gross IS DISTINCT FROM OLD.total_gross
        THEN
            RAISE EXCEPTION 'A released invoice keeps its totals'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF NEW.released_at IS NULL AND NEW.status NOT IN ('draft', 'cancelled') THEN
        NEW.released_at := now();
    END IF;

    -- Only at the release itself: an invoice released before migration
    -- 20261012173000 does not get a (later) number when it is paid or reminded.
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
