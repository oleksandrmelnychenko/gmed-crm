-- Money QA 2026-11-15 (money-B S1-1/S1-2/S2-2, money-C S2-2/S3-7/S3-8, owner 2026-11-15).
-- Forward-only: existing allocations, payments and invoices are not rewritten.

-- 1. A raised order prepayment is billed as a supplementary advance on the
--    same quote. Only one unreleased advance draft per quote; issued advances
--    may be several (the amount rule lives in the invoice routes).
DROP INDEX IF EXISTS idx_invoices_quote_active_advance;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_quote_advance_draft
    ON invoices(quote_id)
    WHERE quote_id IS NOT NULL
      AND invoice_type = 'advance'
      AND status <> 'cancelled'
      AND released_at IS NULL;

-- 2. What an advance deducts on a settlement invoice, per VAT category
--    ({kind, rate, net, vat, gross}); NULL on allocations made before.
ALTER TABLE invoice_prepayment_allocations ADD COLUMN IF NOT EXISTS vat_rows JSONB;
ALTER TABLE invoice_prepayment_allocation_releases ADD COLUMN IF NOT EXISTS vat_rows JSONB;

CREATE OR REPLACE FUNCTION invoice_line_vat_category(line JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN COALESCE(NULLIF(line ->> 'vat_rate', '')::NUMERIC, 0) > 0 THEN 'taxed'
        WHEN COALESCE((line ->> 'is_cost_passthrough')::BOOLEAN, false) THEN 'passthrough'
        ELSE 'zero_rated'
    END
$$;

CREATE OR REPLACE FUNCTION validate_invoice_prepayment_allocation_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target invoices%ROWTYPE;
    rows_gross NUMERIC;
    line_total NUMERIC;
    over_category RECORD;
BEGIN
    IF NEW.vat_rows IS NULL THEN
        RETURN NEW;
    END IF;
    IF jsonb_typeof(NEW.vat_rows) <> 'array' THEN
        RAISE EXCEPTION 'Prepayment allocation VAT rows must be an array';
    END IF;
    SELECT COALESCE(SUM((row_value ->> 'gross')::NUMERIC), 0) INTO rows_gross
    FROM jsonb_array_elements(NEW.vat_rows) AS row_value;
    IF rows_gross <> NEW.amount_gross
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.vat_rows) AS row_value
                  WHERE (row_value ->> 'gross')::NUMERIC < 0
                     OR (row_value ->> 'vat')::NUMERIC < 0) THEN
        RAISE EXCEPTION 'Prepayment allocation VAT rows must add up to the allocated amount';
    END IF;

    SELECT * INTO target FROM invoices WHERE id = NEW.target_invoice_id;
    IF jsonb_typeof(target.line_items) <> 'array' THEN
        RETURN NEW;
    END IF;
    SELECT COALESCE(SUM(NULLIF(line ->> 'line_gross', '')::NUMERIC), 0) INTO line_total
    FROM jsonb_array_elements(target.line_items) AS line;
    IF line_total <> target.total_gross THEN
        -- Lines without amounts (legacy snapshots): no category to compare.
        RETURN NEW;
    END IF;
    -- A settlement invoice never deducts more per VAT category than it bills
    -- in that category: no negative VAT on the final invoice.
    WITH category AS (
        SELECT invoice_line_vat_category(line) AS kind,
               CASE WHEN invoice_line_vat_category(line) = 'taxed'
                    THEN NULLIF(line ->> 'vat_rate', '')::NUMERIC ELSE 0 END AS rate,
               SUM(COALESCE(NULLIF(line ->> 'line_gross', '')::NUMERIC, 0)) AS gross,
               SUM(COALESCE(NULLIF(line ->> 'line_vat', '')::NUMERIC, 0)) AS vat
        FROM jsonb_array_elements(target.line_items) AS line
        GROUP BY 1, 2
    ), deducted AS (
        SELECT row_value ->> 'kind' AS kind,
               CASE WHEN row_value ->> 'kind' = 'taxed'
                    THEN (row_value ->> 'rate')::NUMERIC ELSE 0 END AS rate,
               SUM((row_value ->> 'gross')::NUMERIC) AS gross,
               SUM((row_value ->> 'vat')::NUMERIC) AS vat
        FROM (
            SELECT vat_rows FROM invoice_prepayment_allocations
            WHERE target_invoice_id = NEW.target_invoice_id AND id <> NEW.id
              AND vat_rows IS NOT NULL
            UNION ALL
            SELECT NEW.vat_rows
        ) allocation
        CROSS JOIN LATERAL jsonb_array_elements(allocation.vat_rows) AS row_value
        GROUP BY 1, 2
    )
    SELECT deducted.kind, deducted.rate INTO over_category
    FROM deducted
    LEFT JOIN category ON category.kind = deducted.kind AND category.rate = deducted.rate
    WHERE deducted.gross > COALESCE(category.gross, 0) + 0.005
       OR deducted.vat > COALESCE(category.vat, 0) + 0.005
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Prepayment allocation exceeds the % % category of the target invoice',
            over_category.kind, over_category.rate;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_invoice_prepayment_allocation_rows_trigger
    ON invoice_prepayment_allocations;
CREATE TRIGGER validate_invoice_prepayment_allocation_rows_trigger
    BEFORE INSERT ON invoice_prepayment_allocations
    FOR EACH ROW EXECUTE FUNCTION validate_invoice_prepayment_allocation_rows();

-- The release history keeps the VAT rows of a released allocation.
CREATE OR REPLACE FUNCTION retain_invoice_prepayment_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Prepayment allocations are immutable; release and reapply instead';
    END IF;
    INSERT INTO invoice_prepayment_allocation_releases (
        id, advance_invoice_id, target_invoice_id, amount_gross, created_by, created_at,
        request_id, released_by, vat_rows
    ) VALUES (
        OLD.id, OLD.advance_invoice_id, OLD.target_invoice_id, OLD.amount_gross,
        OLD.created_by, OLD.created_at, OLD.request_id,
        NULLIF(current_setting('gmed.accounting_actor_id', true), '')::UUID,
        OLD.vat_rows
    );
    RETURN OLD;
END;
$$;

-- 3. An advance deducted on an issued final invoice is part of that document
--    (§ 14 Abs. 5 UStG, GoBD): it is released only by the Storno of the final
--    invoice or by a correction document (credit note) of it, never alone.
--    Those paths name themselves in `gmed.prepayment_release_context`.
CREATE OR REPLACE FUNCTION protect_issued_final_prepayment_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(current_setting('gmed.prepayment_release_context', true), '')
           IN ('storno', 'correction') THEN
        RETURN OLD;
    END IF;
    IF EXISTS (
        SELECT 1 FROM invoices target
        WHERE target.id = OLD.target_invoice_id
          AND target.invoice_type = 'final'
          AND target.released_at IS NOT NULL
          AND target.status <> 'cancelled'
    ) THEN
        RAISE EXCEPTION 'Prepayment deducted on an issued final invoice; cancel the final invoice first'
            USING ERRCODE = 'P0001', HINT = 'prepayment_locked_by_issued_final';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_issued_final_prepayment_allocation_trigger
    ON invoice_prepayment_allocations;
CREATE TRIGGER protect_issued_final_prepayment_allocation_trigger
    BEFORE DELETE ON invoice_prepayment_allocations
    FOR EACH ROW EXECUTE FUNCTION protect_issued_final_prepayment_allocation();

-- An advance whose money is applied cannot be cancelled (the route says so
-- first); a cancelled advance would leave the allocation without a source.
CREATE OR REPLACE FUNCTION protect_applied_advance_cancellation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.invoice_type = 'advance'
       AND NEW.status = 'cancelled'
       AND OLD.status IS DISTINCT FROM 'cancelled'
       AND EXISTS (SELECT 1 FROM invoice_prepayment_allocations allocation
                   WHERE allocation.advance_invoice_id = NEW.id) THEN
        RAISE EXCEPTION 'Applied advance payment must be released before cancellation'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_applied_advance_cancellation_trigger ON invoices;
CREATE TRIGGER protect_applied_advance_cancellation_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW EXECUTE FUNCTION protect_applied_advance_cancellation();

-- 4. Owner 2026-11-15: a payment that pays an advance only in part is split
--    pro rata over its VAT categories unless staff set the split by hand.
--    One split per payment row, written with it; a changed split is a payment
--    correction (reversal and new payment), so the booking stays append-only.
CREATE TABLE IF NOT EXISTS invoice_payment_category_splits (
    payment_transaction_id UUID PRIMARY KEY
        REFERENCES invoice_payment_transactions(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    rows JSONB NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payment_category_splits_invoice
    ON invoice_payment_category_splits(invoice_id);

CREATE OR REPLACE FUNCTION validate_invoice_payment_category_split()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment invoice_payment_transactions%ROWTYPE;
    rows_gross NUMERIC;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Payment category splits are append-only';
    END IF;
    SELECT * INTO payment FROM invoice_payment_transactions
    WHERE id = NEW.payment_transaction_id;
    IF payment.id IS NULL OR payment.transaction_type <> 'payment'
       OR payment.invoice_id <> NEW.invoice_id THEN
        RAISE EXCEPTION 'A category split belongs to a payment of the same invoice';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND invoice_type = 'advance') THEN
        RAISE EXCEPTION 'A category split is set only on payments of an advance invoice';
    END IF;
    SELECT COALESCE(SUM((row_value ->> 'gross')::NUMERIC), 0) INTO rows_gross
    FROM jsonb_array_elements(NEW.rows) AS row_value;
    IF rows_gross <> payment.amount_gross
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.rows) AS row_value
                  WHERE (row_value ->> 'gross')::NUMERIC < 0) THEN
        RAISE EXCEPTION 'The category split must add up to the payment amount';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_invoice_payment_category_split_trigger
    ON invoice_payment_category_splits;
CREATE TRIGGER validate_invoice_payment_category_split_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON invoice_payment_category_splits
    FOR EACH ROW EXECUTE FUNCTION validate_invoice_payment_category_split();
