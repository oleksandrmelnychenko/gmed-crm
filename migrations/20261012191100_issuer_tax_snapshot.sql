-- GMED's own tax registration (Steuernummer / USt-IdNr., § 14 Abs. 4 Nr. 2
-- UStG) as of the issue of each document (QA D2-09, 2026-10-12).
--
-- Invoices, credit notes and cancellation documents printed the current
-- system setting whenever they were rendered: a later change of the setting
-- reached documents issued before it. The release of an invoice, the issue of
-- a credit note (or its reversal) and of a cancellation document now keep the
-- registration of that moment; every rendering reads it from there
-- (`routes::invoices::release::issued_tax_registration_sql`). Documents issued
-- before this migration keep `issuer_tax_snapshot` NULL (issued rows are not
-- rewritten, GoBD) and read the current setting as before.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issuer_tax_snapshot JSONB;
ALTER TABLE invoice_credit_note_transactions ADD COLUMN IF NOT EXISTS issuer_tax_snapshot JSONB;
ALTER TABLE invoice_storno_documents ADD COLUMN IF NOT EXISTS issuer_tax_snapshot JSONB;

COMMENT ON COLUMN invoices.issuer_tax_snapshot IS
    'GMED tax registration {tax_number, vat_id, captured_at} taken at the release; NULL for invoices released before 2026-10-12';
COMMENT ON COLUMN invoice_credit_note_transactions.issuer_tax_snapshot IS
    'GMED tax registration {tax_number, vat_id, captured_at} taken at the issue; NULL before 2026-10-12';
COMMENT ON COLUMN invoice_storno_documents.issuer_tax_snapshot IS
    'GMED tax registration {tax_number, vat_id, captured_at} taken at the issue; NULL before 2026-10-12';

CREATE OR REPLACE FUNCTION issuer_tax_registration_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'tax_number', NULLIF(BTRIM((
            SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_tax_number'
        )), ''),
        'vat_id', NULLIF(BTRIM((
            SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_vat_id'
        )), ''),
        'captured_at', now()
    )
$$;

-- Taken once, when the invoice is released (any release path, also direct
-- inserts of released invoices), and never changed afterwards. Runs after
-- `invoices_release_guard`, which sets `released_at` (triggers fire in name
-- order).
CREATE OR REPLACE FUNCTION invoices_release_tax_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.issuer_tax_snapshot IS NOT NULL
        AND NEW.issuer_tax_snapshot IS DISTINCT FROM OLD.issuer_tax_snapshot
    THEN
        RAISE EXCEPTION 'The tax registration of an issued invoice cannot change'
            USING ERRCODE = 'P0001';
    END IF;

    IF NEW.released_at IS NOT NULL
        AND NEW.issuer_tax_snapshot IS NULL
        AND (TG_OP = 'INSERT' OR OLD.released_at IS NULL)
    THEN
        NEW.issuer_tax_snapshot := issuer_tax_registration_snapshot();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_release_tax_snapshot ON invoices;
CREATE TRIGGER invoices_release_tax_snapshot
    BEFORE INSERT OR UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION invoices_release_tax_snapshot();

-- Credit notes, their reversals and cancellation documents: taken when the
-- document is issued, never changed.
CREATE OR REPLACE FUNCTION correction_document_tax_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.issuer_tax_snapshot IS NULL THEN
            NEW.issuer_tax_snapshot := issuer_tax_registration_snapshot();
        END IF;
    ELSIF NEW.issuer_tax_snapshot IS DISTINCT FROM OLD.issuer_tax_snapshot THEN
        RAISE EXCEPTION 'The tax registration of an issued correction document cannot change'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_credit_note_tax_snapshot ON invoice_credit_note_transactions;
CREATE TRIGGER invoice_credit_note_tax_snapshot
    BEFORE INSERT OR UPDATE ON invoice_credit_note_transactions
    FOR EACH ROW
    EXECUTE FUNCTION correction_document_tax_snapshot();

DROP TRIGGER IF EXISTS invoice_storno_tax_snapshot ON invoice_storno_documents;
CREATE TRIGGER invoice_storno_tax_snapshot
    BEFORE INSERT OR UPDATE ON invoice_storno_documents
    FOR EACH ROW
    EXECUTE FUNCTION correction_document_tax_snapshot();
