-- Supplier costs GMED absorbs instead of re-billing them (owner 2026-10-12).
--
-- A GMED-paid supplier cost is a patient receivable until a patient invoice
-- re-bills it. When a credit note credits that patient invoice below the cost
-- (QA D-64), the credited part of the allocation is reversed and the cost is
-- "not billed" again: it shows in «Расходы для перевыставления» and in the
-- patient's debt. Billing (CEO, Billing) can now drop that rest from
-- re-billing with a reason: a waiver records that GMED bears it. The supplier
-- invoice, its payments and its bookkeeping stay unchanged (the cost was
-- already booked as GMED's provider expense); only the patient receivable
-- goes down.
--
-- Waivers are append-only: one is reversed (once, with a reason) to put the
-- amount back into re-billing, never edited or deleted.
CREATE TABLE IF NOT EXISTS external_invoice_rebilling_waivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_invoice_id UUID NOT NULL
        REFERENCES external_invoices(id) ON DELETE RESTRICT,
    request_id UUID NOT NULL,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    reason TEXT NOT NULL
        CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reversal_reason TEXT,
    CONSTRAINT external_invoice_rebilling_waiver_reversal_consistent CHECK (
        (reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
        OR (
            reversed_at IS NOT NULL
            AND reversed_by IS NOT NULL
            AND char_length(btrim(COALESCE(reversal_reason, ''))) BETWEEN 3 AND 1000
        )
    ),
    UNIQUE (external_invoice_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_external_invoice_rebilling_waivers_active
    ON external_invoice_rebilling_waivers(external_invoice_id)
    WHERE reversed_at IS NULL;

CREATE OR REPLACE FUNCTION external_invoice_rebilling_waivers_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Rebilling waivers are append-only; reverse the waiver instead'
            USING ERRCODE = 'P0001';
    END IF;
    IF NEW.external_invoice_id IS DISTINCT FROM OLD.external_invoice_id
        OR NEW.request_id IS DISTINCT FROM OLD.request_id
        OR NEW.amount_gross IS DISTINCT FROM OLD.amount_gross
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'A rebilling waiver is not edited; reverse it and record a new one'
            USING ERRCODE = 'P0001';
    END IF;
    IF OLD.reversed_at IS NOT NULL THEN
        RAISE EXCEPTION 'A reversed rebilling waiver is final'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_invoice_rebilling_waivers_append_only
    ON external_invoice_rebilling_waivers;
CREATE TRIGGER external_invoice_rebilling_waivers_append_only
    BEFORE UPDATE OR DELETE ON external_invoice_rebilling_waivers
    FOR EACH ROW
    EXECUTE FUNCTION external_invoice_rebilling_waivers_append_only();

-- The patient receivable of a supplier invoice is now its payer-based figure
-- minus the active waivers (never below 0). Every balance, the account
-- statement, the debt figures and the billing constructor read it from this
-- view, so a waived cost leaves all of them at once. `waived_receivable_gross`
-- is appended (CREATE OR REPLACE VIEW keeps the existing columns).
CREATE OR REPLACE VIEW external_invoice_receivable_balances AS
SELECT external.id AS external_invoice_id,
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL THEN 0
            ELSE GREATEST(external.patient_receivable_gross - COALESCE(waiver.waived_gross, 0), 0)
       END::NUMERIC(12, 2) AS patient_receivable_gross,
       COALESCE(SUM(allocation.amount_gross) FILTER (
           WHERE allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'
             AND patient_invoice.status <> 'cancelled'
       ), 0)::NUMERIC(12, 2) AS allocated_receivable_gross,
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL THEN 0
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
       CASE WHEN external.invoice_scope = 'company' OR covering_service.id IS NOT NULL THEN 0
            ELSE LEAST(COALESCE(waiver.waived_gross, 0), GREATEST(external.patient_receivable_gross, 0))
       END::NUMERIC(12, 2) AS waived_receivable_gross
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
LEFT JOIN external_invoice_patient_invoice_allocations allocation
       ON allocation.external_invoice_id = external.id
LEFT JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
GROUP BY external.id, external.invoice_scope, external.patient_receivable_gross,
         covering_service.id, waiver.waived_gross;

COMMENT ON VIEW external_invoice_receivable_balances IS
    'Patient receivable of supplier invoices, including amounts reserved by active draft invoices. An invoice attributed to a service that is not cancelled is a GMED cost only (order_service_billed): its receivable is 0. Active rebilling waivers (GMED absorbs the cost) reduce the receivable (waived_receivable_gross).';
COMMENT ON TABLE external_invoice_rebilling_waivers IS
    'Append-only: parts of a GMED-paid supplier cost that GMED bears instead of re-billing them to the patient (reason, actor, time; reversible once).';
