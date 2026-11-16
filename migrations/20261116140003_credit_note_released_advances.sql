-- QA 2026-11-16 (fix-81 open items): a credit note on a settlement invoice
-- releases the advance deductions per VAT category, and its document states
-- what it released.
-- Forward-only: issued credit notes, allocations and documents are not
-- rewritten.

-- 1. The advance deductions a credit note released, as its document prints
--    them ({invoice_number, issue_date, rows}, the shape of
--    `invoice_storno_documents.deducted_advances`). NULL for credit notes
--    issued before and for credit notes that released nothing.
ALTER TABLE invoice_credit_note_transactions
    ADD COLUMN IF NOT EXISTS released_advances JSONB
        CHECK (released_advances IS NULL OR jsonb_typeof(released_advances) = 'array');

-- 2. The first VAT category in which the advances credited into a settlement
--    invoice (with `extra_rows` added, and the allocation `exclude_id` left
--    out) deduct more gross or VAT than the invoice still bills there after
--    its active credit notes. NULL when every category fits, and when the
--    invoice cannot be read per category (lines without amounts, or a
--    credit note without lines).
CREATE OR REPLACE FUNCTION invoice_prepayment_category_overrun(
    target_id UUID,
    extra_rows JSONB,
    exclude_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    target invoices%ROWTYPE;
    line_total NUMERIC;
    over_category RECORD;
BEGIN
    SELECT * INTO target FROM invoices WHERE id = target_id;
    IF target.id IS NULL OR jsonb_typeof(target.line_items) <> 'array' THEN
        RETURN NULL;
    END IF;
    SELECT COALESCE(SUM(NULLIF(line ->> 'line_gross', '')::NUMERIC), 0) INTO line_total
    FROM jsonb_array_elements(target.line_items) AS line;
    IF line_total <> target.total_gross THEN
        -- Lines without amounts (legacy snapshots): no category to compare.
        RETURN NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM invoice_credit_note_transactions credit
        WHERE credit.invoice_id = target_id
          AND credit.transaction_type = 'credit_note'
          AND (credit.line_items IS NULL OR jsonb_typeof(credit.line_items) <> 'array')
          AND NOT EXISTS (
              SELECT 1 FROM invoice_credit_note_transactions reversal
              WHERE reversal.reverses_transaction_id = credit.id
                AND reversal.transaction_type = 'reversal')
    ) THEN
        -- A pro rata credit note has no category of its own.
        RETURN NULL;
    END IF;
    WITH billed AS (
        SELECT line AS item, 1 AS sign
        FROM jsonb_array_elements(target.line_items) AS line
        UNION ALL
        SELECT credited, -1
        FROM invoice_credit_note_transactions credit
        CROSS JOIN LATERAL jsonb_array_elements(credit.line_items) AS credited
        WHERE credit.invoice_id = target_id
          AND credit.transaction_type = 'credit_note'
          AND NOT EXISTS (
              SELECT 1 FROM invoice_credit_note_transactions reversal
              WHERE reversal.reverses_transaction_id = credit.id
                AND reversal.transaction_type = 'reversal')
    ), category AS (
        SELECT invoice_line_vat_category(item) AS kind,
               CASE WHEN invoice_line_vat_category(item) = 'taxed'
                    THEN invoice_line_vat_rate(item) ELSE 0 END AS rate,
               SUM(sign * COALESCE(NULLIF(item ->> 'line_gross', '')::NUMERIC, 0)) AS gross,
               SUM(sign * COALESCE(NULLIF(item ->> 'line_vat', '')::NUMERIC, 0)) AS vat
        FROM billed
        GROUP BY 1, 2
    ), deducted AS (
        SELECT row_value ->> 'kind' AS kind,
               CASE WHEN row_value ->> 'kind' = 'taxed'
                    THEN (row_value ->> 'rate')::NUMERIC ELSE 0 END AS rate,
               SUM((row_value ->> 'gross')::NUMERIC) AS gross,
               SUM((row_value ->> 'vat')::NUMERIC) AS vat
        FROM (
            SELECT vat_rows FROM invoice_prepayment_allocations
            WHERE target_invoice_id = target_id
              AND id IS DISTINCT FROM exclude_id
              AND vat_rows IS NOT NULL
            UNION ALL
            SELECT extra_rows WHERE extra_rows IS NOT NULL
        ) allocation
        CROSS JOIN LATERAL jsonb_array_elements(allocation.vat_rows) AS row_value
        GROUP BY 1, 2
    )
    SELECT deducted.kind, deducted.rate INTO over_category
    FROM deducted
    LEFT JOIN category ON category.kind = deducted.kind AND category.rate = deducted.rate
    WHERE (deducted.gross > COALESCE(category.gross, 0) + 0.005
           OR deducted.vat > COALESCE(category.vat, 0) + 0.005)
      -- A new allocation answers for the categories it deducts in.
      AND (extra_rows IS NULL OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(extra_rows) AS own
          WHERE own ->> 'kind' = deducted.kind
            AND (CASE WHEN own ->> 'kind' = 'taxed'
                      THEN (own ->> 'rate')::NUMERIC ELSE 0 END) = deducted.rate))
    LIMIT 1;
    IF FOUND THEN
        RETURN over_category.kind || ' ' || over_category.rate::TEXT;
    END IF;
    RETURN NULL;
END;
$$;

-- 3. An allocation never deducts more per VAT category than the settlement
--    invoice still bills there after its credit notes (before: its lines
--    only).
CREATE OR REPLACE FUNCTION validate_invoice_prepayment_allocation_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    rows_gross NUMERIC;
    over_category TEXT;
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
    over_category := invoice_prepayment_category_overrun(
        NEW.target_invoice_id, NEW.vat_rows, NEW.id);
    IF over_category IS NOT NULL THEN
        RAISE EXCEPTION 'Prepayment allocation exceeds the % category of the target invoice',
            over_category;
    END IF;
    RETURN NEW;
END;
$$;

-- 4. A credit note on a settlement invoice leaves no VAT category deducting
--    more advance money than the invoice still bills there: the credit note
--    releases the excess in the same transaction (checked at commit).
CREATE OR REPLACE FUNCTION validate_credit_note_prepayment_categories()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    over_category TEXT;
BEGIN
    IF NEW.transaction_type <> 'credit_note' THEN
        RETURN NULL;
    END IF;
    over_category := invoice_prepayment_category_overrun(NEW.invoice_id, NULL, NULL);
    IF over_category IS NOT NULL THEN
        RAISE EXCEPTION 'Advance deductions exceed the % category of the credited invoice',
            over_category;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS validate_credit_note_prepayment_categories_trigger
    ON invoice_credit_note_transactions;
CREATE CONSTRAINT TRIGGER validate_credit_note_prepayment_categories_trigger
    AFTER INSERT ON invoice_credit_note_transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_credit_note_prepayment_categories();
