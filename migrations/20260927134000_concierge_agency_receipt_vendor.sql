-- A concierge receipt GMED already paid may come from a vendor that is no
-- registered partner (a restaurant or florist booked for the patient). Such a
-- receipt is posted with the vendor as the invoice's supplier name instead of
-- a partner. Unpaid receipts keep requiring an active non-medical partner,
-- because the amount stays owed to them. Only the partner check of the
-- review-event validation changes; the rest is the function as defined in
-- 20260820111500_concierge_expense_receipts.

CREATE OR REPLACE FUNCTION validate_concierge_expense_review_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    submission concierge_expense_submissions%ROWTYPE;
    external_row external_invoices%ROWTYPE;
    original concierge_expense_review_events%ROWTYPE;
    provider_payment external_invoice_provider_payment_transactions%ROWTYPE;
    net_provider_paid NUMERIC(12, 2);
BEGIN
    SELECT * INTO submission
    FROM concierge_expense_submissions
    WHERE id = NEW.expense_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'concierge expense submission does not exist';
    END IF;

    IF NEW.action = 'posted' THEN
        SELECT * INTO external_row
        FROM external_invoices
        WHERE id = NEW.external_invoice_id
        FOR UPDATE;
        IF NOT FOUND
           OR external_row.patient_id <> submission.patient_id
           OR (submission.order_id IS NOT NULL AND external_row.order_id <> submission.order_id)
           OR (submission.order_leistung_id IS NOT NULL
               AND external_row.order_leistung_id IS DISTINCT FROM submission.order_leistung_id)
           OR upper(external_row.currency) <> submission.currency
           OR external_row.amount_net <> submission.amount_net
           OR external_row.amount_vat <> submission.amount_vat
           OR external_row.amount_gross <> submission.amount_gross
           OR external_row.invoice_date IS DISTINCT FROM submission.expense_date
           OR external_row.service_delivered IS DISTINCT FROM submission.service_delivered
        THEN
            RAISE EXCEPTION 'posted external invoice must mirror the concierge expense';
        END IF;
        IF submission.paid_by = 'patient'
           AND NOT (external_row.status = 'paid' AND external_row.paid_by = 'patient')
        THEN
            RAISE EXCEPTION 'patient-paid expense must remain patient-paid';
        ELSIF submission.paid_by = 'agency'
           AND NOT (external_row.status = 'paid' AND external_row.paid_by = 'agency')
        THEN
            RAISE EXCEPTION 'agency-paid expense must be posted through provider settlement';
        ELSIF submission.paid_by = 'unpaid'
           AND NOT (
               external_row.paid_by = 'unpaid'
               AND external_row.status IN ('received', 'approved', 'overdue')
           )
        THEN
            RAISE EXCEPTION 'unpaid expense must remain unpaid';
        END IF;
        -- An unpaid receipt stays owed to a partner, so it needs one. A receipt
        -- GMED already paid may come from a vendor that is no registered
        -- partner (a restaurant, a florist); its invoice then names the vendor.
        IF submission.paid_by = 'agency'
           AND external_row.provider_id IS NULL
        THEN
            IF NULLIF(BTRIM(external_row.supplier_name), '') IS NULL THEN
                RAISE EXCEPTION 'agency-paid expense without a partner must name its vendor';
            END IF;
        ELSIF submission.paid_by <> 'patient'
           AND (
               external_row.provider_id IS NULL
               OR NOT EXISTS (
                   SELECT 1 FROM providers provider
                   WHERE provider.id = external_row.provider_id
                     AND provider.provider_type = 'non_medical'
                     AND provider.is_active
               )
           )
        THEN
            RAISE EXCEPTION 'posted concierge provider must be an active non-medical partner';
        END IF;
        IF NEW.provider_payment_transaction_id IS NOT NULL THEN
            SELECT * INTO provider_payment
            FROM external_invoice_provider_payment_transactions
            WHERE id = NEW.provider_payment_transaction_id
            FOR UPDATE;
            IF NOT FOUND
               OR provider_payment.external_invoice_id <> NEW.external_invoice_id
               OR provider_payment.transaction_type <> 'payment'
               OR provider_payment.amount_gross <> submission.amount_gross
               OR provider_payment.currency <> submission.currency
            THEN
                RAISE EXCEPTION 'provider payment must be the full payment for the posted expense';
            END IF;
        ELSIF submission.paid_by = 'agency' THEN
            RAISE EXCEPTION 'agency-paid expense requires its canonical provider payment';
        END IF;
    ELSIF NEW.action = 'reversed' THEN
        SELECT * INTO original
        FROM concierge_expense_review_events
        WHERE id = NEW.reverses_event_id
        FOR UPDATE;
        IF NOT FOUND
           OR original.expense_id <> NEW.expense_id
           OR original.action <> 'posted'
           OR original.external_invoice_id <> NEW.external_invoice_id
        THEN
            RAISE EXCEPTION 'reversal must reference the posted concierge expense';
        END IF;
        SELECT COALESCE(SUM(
            CASE WHEN payment.transaction_type = 'payment'
                 THEN payment.amount_gross ELSE -payment.amount_gross END
        ), 0)
        INTO net_provider_paid
        FROM external_invoice_provider_payment_transactions payment
        WHERE payment.external_invoice_id = NEW.external_invoice_id;
        IF net_provider_paid <> 0 THEN
            RAISE EXCEPTION 'reverse provider payments before reversing the concierge expense';
        END IF;
        PERFORM patient_invoice.id
        FROM external_invoice_patient_invoice_allocations allocation
        JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
        WHERE allocation.external_invoice_id = NEW.external_invoice_id
        ORDER BY patient_invoice.id
        FOR UPDATE OF patient_invoice;
        IF EXISTS (
            SELECT 1
            FROM external_invoice_patient_invoice_allocations allocation
            JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
            WHERE allocation.external_invoice_id = NEW.external_invoice_id
              AND allocation.reversed_at IS NULL
              AND patient_invoice.status NOT IN ('draft', 'cancelled')
        ) THEN
            RAISE EXCEPTION 'reverse patient invoice allocations before reversing the concierge expense';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM external_invoice_patient_invoice_allocations allocation
            JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
            WHERE allocation.external_invoice_id = NEW.external_invoice_id
              AND patient_invoice.status NOT IN ('draft', 'cancelled')
            GROUP BY allocation.patient_invoice_id, patient_invoice.credited_amount
            HAVING COALESCE(patient_invoice.credited_amount, 0)
                   < SUM(allocation.amount_gross)
        ) THEN
            RAISE EXCEPTION 'correct patient invoices before reversing the concierge expense';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
