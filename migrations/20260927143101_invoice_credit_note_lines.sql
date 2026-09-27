-- Credit notes (Rechnungskorrekturen) per invoice line and per VAT rate.
--
-- A credit note used to spread its VAT pro rata over the whole invoice, so a
-- 481.50 credit for a 0 % pass-through hotel line was stored with 53.91 VAT
-- and reduced output VAT that was never charged. New credit notes carry the
-- credited invoice lines: every line keeps its own VAT rate and pass-through
-- flag, and the stored net/VAT/gross are the sums of those lines. Existing
-- credit notes keep their pro-rata amounts (credit_mode 'legacy_pro_rata',
-- no line_items) and stay valid.

ALTER TABLE invoice_credit_note_transactions
    ADD COLUMN IF NOT EXISTS credit_mode TEXT NOT NULL DEFAULT 'legacy_pro_rata',
    ADD COLUMN IF NOT EXISTS line_items JSONB,
    ADD COLUMN IF NOT EXISTS request_selection JSONB;

ALTER TABLE invoice_credit_note_transactions
    DROP CONSTRAINT IF EXISTS invoice_credit_note_credit_mode_valid;
ALTER TABLE invoice_credit_note_transactions
    ADD CONSTRAINT invoice_credit_note_credit_mode_valid CHECK (
        credit_mode IN ('legacy_pro_rata', 'lines', 'vat_rate')
        AND (credit_mode = 'legacy_pro_rata') = (line_items IS NULL)
        AND (
            line_items IS NULL
            OR (jsonb_typeof(line_items) = 'array' AND jsonb_array_length(line_items) > 0)
        )
    );

COMMENT ON COLUMN invoice_credit_note_transactions.credit_mode IS
    'lines: selected invoice lines; vat_rate: an amount within one VAT rate spread over its lines; legacy_pro_rata: pre-2026-09-27 credit split pro rata over the invoice.';
COMMENT ON COLUMN invoice_credit_note_transactions.line_items IS
    'Credited invoice lines: invoice_line_index, description, quantity, unit_price, vat_rate, is_cost_passthrough, line_net, line_vat, line_gross. NULL for legacy pro-rata credit notes.';
COMMENT ON COLUMN invoice_credit_note_transactions.request_selection IS
    'Normalised staff selection (lines or VAT rate and amount) of the request, compared on idempotent replays.';

-- Patient cash received beyond the adjusted invoice total (an overpayment or a
-- credit note not yet refunded) is not revenue: it is booked separately until
-- it is refunded or moved to another invoice.
ALTER TABLE accounting_entries
    DROP CONSTRAINT IF EXISTS accounting_entries_category_check;
ALTER TABLE accounting_entries
    ADD CONSTRAINT accounting_entries_category_check CHECK (
        category IN (
            'service_revenue',
            'cost_passthrough_revenue',
            'patient_credit',
            'provider_expense'
        )
    );

CREATE OR REPLACE FUNCTION validate_invoice_credit_note_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    invoice_total NUMERIC(12, 2);
    invoice_status TEXT;
    invoice_currency TEXT;
    invoice_issued_on DATE;
    invoice_lines JSONB;
    original invoice_credit_note_transactions%ROWTYPE;
    active_credit NUMERIC(12, 2);
    allocated_external NUMERIC(12, 2);
    allocated_advance NUMERIC(12, 2);
    applied_prepayment NUMERIC(12, 2);
    credited_line RECORD;
    line_count INTEGER;
    line_gross_total NUMERIC(12, 2);
    already_credited NUMERIC(12, 2);
BEGIN
    SELECT invoice.total_gross, invoice.status, UPPER(invoice.currency),
           invoice.issued_at::date, invoice.line_items
    INTO invoice_total, invoice_status, invoice_currency, invoice_issued_on, invoice_lines
    FROM invoices invoice
    WHERE invoice.id = NEW.invoice_id
    FOR UPDATE OF invoice;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invoice for credit note does not exist';
    END IF;
    IF invoice_status IN ('draft', 'cancelled') THEN
        RAISE EXCEPTION 'credit notes require an active released invoice';
    END IF;
    IF UPPER(NEW.currency) <> invoice_currency THEN
        RAISE EXCEPTION 'credit note currency must match invoice currency';
    END IF;

    IF NEW.transaction_type = 'reversal' THEN
        SELECT * INTO original
        FROM invoice_credit_note_transactions
        WHERE id = NEW.reverses_transaction_id
        FOR UPDATE;

        IF NOT FOUND
            OR original.invoice_id <> NEW.invoice_id
            OR original.transaction_type <> 'credit_note'
            OR original.amount_net <> NEW.amount_net
            OR original.amount_vat <> NEW.amount_vat
            OR original.amount_gross <> NEW.amount_gross
            OR original.currency <> NEW.currency
            OR original.credit_mode <> NEW.credit_mode
            OR original.line_items IS DISTINCT FROM NEW.line_items
        THEN
            RAISE EXCEPTION 'credit-note reversal must match its original transaction';
        END IF;
        IF NEW.issued_on < original.issued_on THEN
            RAISE EXCEPTION 'credit-note reversal date cannot precede the original credit note';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM invoice_credit_note_transactions reversal
            WHERE reversal.reverses_transaction_id = original.id
              AND reversal.transaction_type = 'reversal'
        ) THEN
            RAISE EXCEPTION 'credit note was already reversed';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.issued_on < invoice_issued_on THEN
        RAISE EXCEPTION 'credit-note date cannot precede the invoice date';
    END IF;

    IF NEW.line_items IS NOT NULL THEN
        SELECT COUNT(*),
               COALESCE(SUM((item.value ->> 'line_gross')::NUMERIC), 0)
        INTO line_count, line_gross_total
        FROM jsonb_array_elements(NEW.line_items) AS item(value);
        IF line_gross_total <> NEW.amount_gross
            OR (SELECT COALESCE(SUM((item.value ->> 'line_net')::NUMERIC), 0)
                FROM jsonb_array_elements(NEW.line_items) AS item(value)) <> NEW.amount_net
            OR (SELECT COALESCE(SUM((item.value ->> 'line_vat')::NUMERIC), 0)
                FROM jsonb_array_elements(NEW.line_items) AS item(value)) <> NEW.amount_vat
        THEN
            RAISE EXCEPTION 'credit-note totals must equal the sum of its credited lines';
        END IF;

        FOR credited_line IN
            SELECT (item.value ->> 'invoice_line_index')::INTEGER AS line_index,
                   (item.value ->> 'line_net')::NUMERIC AS line_net,
                   (item.value ->> 'line_vat')::NUMERIC AS line_vat,
                   (item.value ->> 'line_gross')::NUMERIC AS line_gross
            FROM jsonb_array_elements(NEW.line_items) AS item(value)
        LOOP
            IF credited_line.line_index IS NULL
                OR credited_line.line_index < 0
                OR jsonb_typeof(invoice_lines) <> 'array'
                OR credited_line.line_index >= jsonb_array_length(invoice_lines)
            THEN
                RAISE EXCEPTION 'credited line does not exist on the invoice';
            END IF;
            IF credited_line.line_gross IS NULL OR credited_line.line_gross <= 0
                OR credited_line.line_net < 0 OR credited_line.line_vat < 0
                OR credited_line.line_net + credited_line.line_vat <> credited_line.line_gross
            THEN
                RAISE EXCEPTION 'credited line amounts are inconsistent';
            END IF;

            SELECT COALESCE(SUM((item.value ->> 'line_gross')::NUMERIC), 0)
            INTO already_credited
            FROM invoice_credit_note_transactions credit
            CROSS JOIN LATERAL jsonb_array_elements(credit.line_items) AS item(value)
            WHERE credit.invoice_id = NEW.invoice_id
              AND credit.transaction_type = 'credit_note'
              AND credit.line_items IS NOT NULL
              AND (item.value ->> 'invoice_line_index')::INTEGER = credited_line.line_index
              AND NOT EXISTS (
                  SELECT 1
                  FROM invoice_credit_note_transactions reversal
                  WHERE reversal.reverses_transaction_id = credit.id
                    AND reversal.transaction_type = 'reversal'
              );
            IF already_credited + credited_line.line_gross > COALESCE(
                NULLIF(invoice_lines -> credited_line.line_index ->> 'line_gross', '')::NUMERIC,
                0
            ) THEN
                RAISE EXCEPTION 'credit note exceeds the credited invoice line';
            END IF;
        END LOOP;
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'credit_note' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO active_credit
    FROM invoice_credit_note_transactions
    WHERE invoice_id = NEW.invoice_id;

    IF active_credit + NEW.amount_gross > invoice_total THEN
        RAISE EXCEPTION 'credit note exceeds the invoice gross total';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO allocated_external
    FROM external_invoice_patient_invoice_allocations allocation
    JOIN external_invoices external ON external.id = allocation.external_invoice_id
    WHERE allocation.patient_invoice_id = NEW.invoice_id
      AND allocation.reversed_at IS NULL
      AND external.status <> 'cancelled';

    IF invoice_total - active_credit - NEW.amount_gross < allocated_external THEN
        RAISE EXCEPTION 'credit note would reduce invoice below reconciled external receivables';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO allocated_advance
    FROM invoice_prepayment_allocations allocation
    WHERE allocation.advance_invoice_id = NEW.invoice_id;

    IF invoice_total - active_credit - NEW.amount_gross < allocated_advance THEN
        RAISE EXCEPTION 'credit note would reduce advance below applied prepayments';
    END IF;

    SELECT COALESCE(SUM(allocation.amount_gross), 0)
    INTO applied_prepayment
    FROM invoice_prepayment_allocations allocation
    WHERE allocation.target_invoice_id = NEW.invoice_id;

    IF invoice_total - active_credit - NEW.amount_gross < applied_prepayment THEN
        RAISE EXCEPTION 'credit note would reduce invoice below applied prepayments';
    END IF;
    RETURN NEW;
END;
$$;
