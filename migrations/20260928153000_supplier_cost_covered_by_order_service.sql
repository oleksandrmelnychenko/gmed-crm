-- A supplier invoice attributed to an order service that is billed or still
-- billable to the patient (any service that is not cancelled, regular or
-- pass-through) is a GMED cost only: the service line is the patient's claim.
-- Such an invoice is no patient receivable, so the account statement, balances
-- and the billing constructor do not count it on top of the service, with or
-- without a manual link to a patient invoice.
--
-- A GMED-paid (or delivered, still unpaid) supplier cost stays a patient
-- receivable, to be re-billed at cost, while no billed service covers it:
-- not attributed to a service, or attributed to a cancelled one.
--
-- Nothing stored changes: external_invoices.patient_receivable_gross keeps the
-- payer-based figure (and still bounds manual allocations); only this derived
-- view applies the rule. Bookkeeping of the supplier invoice is not affected.

CREATE OR REPLACE VIEW external_invoice_receivable_balances AS
SELECT external.id AS external_invoice_id,
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL THEN 0
            ELSE external.patient_receivable_gross END::NUMERIC(12, 2)
            AS patient_receivable_gross,
       COALESCE(SUM(allocation.amount_gross) FILTER (
           WHERE allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'
             AND patient_invoice.status <> 'cancelled'
       ), 0)::NUMERIC(12, 2) AS allocated_receivable_gross,
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL THEN 0
            ELSE GREATEST(
                external.patient_receivable_gross
                - COALESCE(SUM(allocation.amount_gross) FILTER (
                    WHERE allocation.reversed_at IS NULL
                      AND external.status <> 'cancelled'
                      AND patient_invoice.status <> 'cancelled'
                ), 0), 0)
       END::NUMERIC(12, 2) AS remaining_receivable_gross,
       (covering_service.id IS NOT NULL) AS order_service_billed
FROM external_invoices external
LEFT JOIN order_leistungen covering_service
       ON covering_service.id = external.order_leistung_id
      AND covering_service.status <> 'cancelled'
LEFT JOIN external_invoice_patient_invoice_allocations allocation
       ON allocation.external_invoice_id = external.id
LEFT JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
GROUP BY external.id, external.invoice_scope, external.patient_receivable_gross,
         covering_service.id;

COMMENT ON VIEW external_invoice_receivable_balances IS
    'Patient receivable of supplier invoices, including amounts reserved by active draft invoices. An invoice attributed to a service that is not cancelled is a GMED cost only (order_service_billed): its receivable is 0.';
COMMENT ON COLUMN external_invoices.patient_receivable_gross IS
    'Payer-based receivable (agency-paid or delivered unpaid cost). The patient figure is external_invoice_receivable_balances.patient_receivable_gross, which is 0 while a billed order service covers the cost.';
