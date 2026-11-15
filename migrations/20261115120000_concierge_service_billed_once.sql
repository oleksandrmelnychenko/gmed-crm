-- Money QA 2026-11-15, D-02: one concierge service was billable twice — at
-- its sale price (invoice_concierge_service_lines, F-C8) and through its
-- receipt re-billed at cost (external_invoice_patient_invoice_allocations of
-- the receipt's external invoice). Owner 2026-11-12 (concierge decisions 1
-- and 7): one billing path per cost, a sale price never counted twice.
--
--   * concierge_receipt_services names the concierge service of a posted
--     receipt (direct, else through the receipt's task).
--   * external_invoice_receivable_balances: a receipt whose service a live
--     invoice (draft or released, not cancelled) bills at its sale price is
--     GMED's cost of that service, no patient receivable
--     (concierge_sale_billed). Cancelling that invoice frees the receipt.
--   * Two triggers refuse the second path under a row lock on the service:
--     a sale-price line while a live invoice re-bills a receipt of the
--     service, and a receipt allocation while a live invoice bills the
--     service at its sale price. Constraint name concierge_service_billed_once
--     lets the API answer 409 with a concrete message.
-- Nothing stored changes.

CREATE OR REPLACE VIEW concierge_receipt_services AS
SELECT external.id AS external_invoice_id,
       COALESCE(receipt.concierge_service_id, receipt_task.concierge_service_id)
           AS concierge_service_id
FROM external_invoices external
JOIN concierge_expense_submissions receipt
  ON receipt.id = external.source_concierge_expense_id
LEFT JOIN tasks receipt_task ON receipt_task.id = receipt.task_id
WHERE COALESCE(receipt.concierge_service_id, receipt_task.concierge_service_id) IS NOT NULL;

COMMENT ON VIEW concierge_receipt_services IS
    'Concierge service of a posted concierge receipt (external invoice). Used to bill a concierge cost one way only (QA D-02, 2026-11-15).';

CREATE OR REPLACE VIEW external_invoice_receivable_balances AS
SELECT external.id AS external_invoice_id,
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL
                 OR concierge_sale.billed THEN 0
            ELSE GREATEST(external.patient_receivable_gross - COALESCE(waiver.waived_gross, 0), 0)
       END::NUMERIC(12, 2) AS patient_receivable_gross,
       COALESCE(SUM(allocation.amount_gross) FILTER (
           WHERE allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'
             AND patient_invoice.status <> 'cancelled'
       ), 0)::NUMERIC(12, 2) AS allocated_receivable_gross,
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL
                 OR concierge_sale.billed THEN 0
            ELSE GREATEST(
                external.patient_receivable_gross
                - COALESCE(waiver.waived_gross, 0)
                - COALESCE(SUM(allocation.amount_gross) FILTER (
                    WHERE allocation.reversed_at IS NULL
                      AND external.status <> 'cancelled'
                      AND patient_invoice.status <> 'cancelled'
                ), 0), 0)
       END::NUMERIC(12, 2) AS remaining_receivable_gross,
       (covering_service.id IS NOT NULL) AS order_service_billed,
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL
                 OR concierge_sale.billed THEN 0
            ELSE LEAST(COALESCE(waiver.waived_gross, 0), GREATEST(external.patient_receivable_gross, 0))
       END::NUMERIC(12, 2) AS waived_receivable_gross,
       COALESCE(concierge_sale.billed, false) AS concierge_sale_billed
FROM external_invoices external
LEFT JOIN order_leistungen covering_service
       ON covering_service.id = external.order_leistung_id
      AND covering_service.status <> 'cancelled'
LEFT JOIN LATERAL (
    SELECT SUM(active_waiver.amount_gross) AS waived_gross
    FROM external_invoice_rebilling_waivers active_waiver
    WHERE active_waiver.external_invoice_id = external.id
      AND active_waiver.reversed_at IS NULL
) waiver ON true
LEFT JOIN LATERAL (
    SELECT true AS billed
    FROM concierge_receipt_services receipt_service
    JOIN invoice_concierge_service_lines sale_link
      ON sale_link.concierge_service_id = receipt_service.concierge_service_id
    JOIN invoices sale_invoice
      ON sale_invoice.id = sale_link.invoice_id
     AND sale_invoice.status <> 'cancelled'
    WHERE receipt_service.external_invoice_id = external.id
    LIMIT 1
) concierge_sale ON true
LEFT JOIN external_invoice_patient_invoice_allocations allocation
       ON allocation.external_invoice_id = external.id
LEFT JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
GROUP BY external.id, external.invoice_scope, external.patient_receivable_gross,
         covering_service.id, waiver.waived_gross, concierge_sale.billed;

COMMENT ON VIEW external_invoice_receivable_balances IS
    'Patient receivable of supplier invoices, including amounts reserved by active draft invoices. An invoice attributed to a service that is not cancelled (order_service_billed), or a concierge receipt whose service a live invoice bills at its sale price (concierge_sale_billed), is a GMED cost only: its receivable is 0.';

CREATE OR REPLACE FUNCTION concierge_service_refuse_second_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_service_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'invoice_concierge_service_lines' THEN
        v_service_id := NEW.concierge_service_id;
    ELSE
        IF NEW.reversed_at IS NOT NULL THEN
            RETURN NEW;
        END IF;
        SELECT receipt_service.concierge_service_id INTO v_service_id
        FROM concierge_receipt_services receipt_service
        WHERE receipt_service.external_invoice_id = NEW.external_invoice_id;
        IF v_service_id IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Both paths lock the service row first: two drafts are serialised.
    PERFORM 1 FROM concierge_services WHERE id = v_service_id FOR UPDATE;

    IF TG_TABLE_NAME = 'invoice_concierge_service_lines' THEN
        IF EXISTS (
            SELECT 1
            FROM concierge_receipt_services receipt_service
            JOIN external_invoices external
              ON external.id = receipt_service.external_invoice_id
             AND external.status <> 'cancelled'
            JOIN external_invoice_patient_invoice_allocations allocation
              ON allocation.external_invoice_id = receipt_service.external_invoice_id
             AND allocation.reversed_at IS NULL
            JOIN invoices rebilling ON rebilling.id = allocation.patient_invoice_id
             AND rebilling.status <> 'cancelled'
            WHERE receipt_service.concierge_service_id = v_service_id
        ) THEN
            RAISE EXCEPTION 'concierge service % is already billed through its receipt', v_service_id
                USING ERRCODE = '23514', CONSTRAINT = 'concierge_service_billed_once';
        END IF;
    ELSIF EXISTS (
        SELECT 1
        FROM invoice_concierge_service_lines sale_link
        JOIN invoices sale_invoice ON sale_invoice.id = sale_link.invoice_id
         AND sale_invoice.status <> 'cancelled'
        WHERE sale_link.concierge_service_id = v_service_id
    ) THEN
        RAISE EXCEPTION 'concierge service % is already billed at its sale price', v_service_id
            USING ERRCODE = '23514', CONSTRAINT = 'concierge_service_billed_once';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_concierge_sale_line_billed_once ON invoice_concierge_service_lines;
CREATE TRIGGER trg_concierge_sale_line_billed_once
    BEFORE INSERT ON invoice_concierge_service_lines
    FOR EACH ROW EXECUTE FUNCTION concierge_service_refuse_second_billing();

DROP TRIGGER IF EXISTS trg_concierge_receipt_rebilled_once ON external_invoice_patient_invoice_allocations;
CREATE TRIGGER trg_concierge_receipt_rebilled_once
    BEFORE INSERT ON external_invoice_patient_invoice_allocations
    FOR EACH ROW EXECUTE FUNCTION concierge_service_refuse_second_billing();
