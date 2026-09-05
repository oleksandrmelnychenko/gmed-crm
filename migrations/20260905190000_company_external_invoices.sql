-- Supplier invoices addressed directly to GMED are valid company payables even
-- when they are not attributable to a patient or an order.

ALTER TABLE external_invoices
    ADD COLUMN IF NOT EXISTS invoice_scope TEXT NOT NULL DEFAULT 'patient_order',
    ADD COLUMN IF NOT EXISTS supplier_name TEXT;

UPDATE external_invoices external
SET supplier_name = provider.name
FROM providers provider
WHERE external.provider_id = provider.id
  AND NULLIF(BTRIM(external.supplier_name), '') IS NULL;

ALTER TABLE external_invoices
    ALTER COLUMN order_id DROP NOT NULL,
    ALTER COLUMN patient_id DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS external_invoice_order_or_concierge_source,
    DROP CONSTRAINT IF EXISTS external_invoice_scope_check,
    DROP CONSTRAINT IF EXISTS external_invoice_scope_context;

ALTER TABLE external_invoices
    ADD CONSTRAINT external_invoice_scope_check
        CHECK (invoice_scope IN ('patient_order', 'company')),
    ADD CONSTRAINT external_invoice_scope_context
        CHECK (
            (
                invoice_scope = 'patient_order'
                AND patient_id IS NOT NULL
                AND (order_id IS NOT NULL OR source_concierge_expense_id IS NOT NULL)
            )
            OR
            (
                invoice_scope = 'company'
                AND patient_id IS NULL
                AND order_id IS NULL
                AND source_concierge_expense_id IS NULL
                AND order_leistung_id IS NULL
            )
        );

CREATE UNIQUE INDEX IF NOT EXISTS external_invoices_company_number_unique
    ON external_invoices (LOWER(COALESCE(supplier_name, '')), external_invoice_number)
    WHERE invoice_scope = 'company';

CREATE INDEX IF NOT EXISTS external_invoices_company_status_due
    ON external_invoices (status, due_date, created_at DESC)
    WHERE invoice_scope = 'company';

CREATE OR REPLACE FUNCTION validate_external_invoice_service_economics()
RETURNS trigger AS $$
DECLARE
    service_order_id UUID;
    service_currency TEXT;
    service_provider_id UUID;
    order_currency TEXT;
    source_patient_id UUID;
    source_currency TEXT;
    source_order_id UUID;
    source_order_leistung_id UUID;
BEGIN
    IF NEW.invoice_scope = 'company' THEN
        IF NEW.patient_id IS NOT NULL
           OR NEW.order_id IS NOT NULL
           OR NEW.order_leistung_id IS NOT NULL
           OR NEW.source_concierge_expense_id IS NOT NULL
        THEN
            RAISE EXCEPTION 'Company invoice cannot use patient or order context';
        END IF;
        IF UPPER(BTRIM(NEW.currency)) !~ '^[A-Z]{3}$' THEN
            RAISE EXCEPTION 'Company invoice currency must be a three-letter code';
        END IF;
        NEW.currency := UPPER(BTRIM(NEW.currency));
        RETURN NEW;
    END IF;

    IF NEW.source_concierge_expense_id IS NOT NULL THEN
        SELECT patient_id, currency, order_id, order_leistung_id
        INTO source_patient_id, source_currency, source_order_id, source_order_leistung_id
        FROM concierge_expense_submissions
        WHERE id = NEW.source_concierge_expense_id
        FOR SHARE;

        IF source_patient_id IS NULL
           OR NEW.patient_id <> source_patient_id
           OR UPPER(NEW.currency) <> source_currency
        THEN
            RAISE EXCEPTION 'External invoice must match its Concierge expense source';
        END IF;
        IF source_order_id IS NOT NULL
           AND NEW.order_id IS DISTINCT FROM source_order_id
        THEN
            RAISE EXCEPTION 'External invoice must preserve the submitted Concierge order';
        END IF;
        IF source_order_leistung_id IS NOT NULL
           AND NEW.order_leistung_id IS DISTINCT FROM source_order_leistung_id
        THEN
            RAISE EXCEPTION 'External invoice must preserve the submitted Concierge order service';
        END IF;
    END IF;

    IF NEW.order_id IS NULL THEN
        IF NEW.source_concierge_expense_id IS NULL THEN
            RAISE EXCEPTION 'External invoice without order requires a Concierge expense source';
        END IF;
        IF NEW.order_leistung_id IS NOT NULL THEN
            RAISE EXCEPTION 'External invoice service requires an order';
        END IF;
        NEW.currency := source_currency;
        RETURN NEW;
    END IF;

    SELECT UPPER(currency)
    INTO order_currency
    FROM orders
    WHERE id = NEW.order_id
    FOR SHARE;

    IF order_currency IS NULL OR UPPER(NEW.currency) <> order_currency THEN
        RAISE EXCEPTION 'External invoice currency must match order currency';
    END IF;

    IF NEW.order_leistung_id IS NOT NULL THEN
        SELECT order_id, UPPER(currency), provider_id
        INTO service_order_id, service_currency, service_provider_id
        FROM order_leistungen
        WHERE id = NEW.order_leistung_id
        FOR UPDATE;

        IF service_order_id IS NULL THEN
            RAISE EXCEPTION 'Order service not found';
        END IF;
        IF service_order_id <> NEW.order_id THEN
            RAISE EXCEPTION 'External invoice service must belong to the same order';
        END IF;
        IF service_currency <> order_currency THEN
            RAISE EXCEPTION 'Order service currency must match order currency';
        END IF;
        IF NEW.provider_id IS NOT NULL
           AND service_provider_id IS NOT NULL
           AND NEW.provider_id <> service_provider_id THEN
            RAISE EXCEPTION 'External invoice provider must match order service provider';
        END IF;
    END IF;

    NEW.currency := order_currency;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_external_invoice_source_document()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_document_id IS NOT NULL THEN
        PERFORM 1 FROM documents
        WHERE id = NEW.source_document_id
          AND patient_id IS NOT DISTINCT FROM NEW.patient_id
          AND order_id IS NOT DISTINCT FROM NEW.order_id
          AND (
              NEW.invoice_scope <> 'company'
              OR (lead_id IS NULL AND appointment_id IS NULL)
          )
          AND is_medical = false
          AND file_deleted_at IS NULL
        FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invoice source document must belong to the same invoice context'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_external_invoice_document_context()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM external_invoices external
        WHERE external.source_document_id = NEW.id
          AND (
              external.patient_id IS DISTINCT FROM NEW.patient_id
              OR external.order_id IS DISTINCT FROM NEW.order_id
              OR NEW.is_medical = true
              OR (
                  external.invoice_scope = 'company'
                  AND (NEW.lead_id IS NOT NULL OR NEW.appointment_id IS NOT NULL)
              )
          )
    ) THEN
        RAISE EXCEPTION 'An invoice source document cannot be assigned to another context'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_invoice_document_context ON documents;
CREATE TRIGGER external_invoice_document_context
    BEFORE UPDATE OF patient_id, lead_id, order_id, appointment_id, is_medical ON documents
    FOR EACH ROW EXECUTE FUNCTION protect_external_invoice_document_context();

CREATE OR REPLACE VIEW external_invoice_receivable_balances AS
SELECT external.id AS external_invoice_id,
       CASE WHEN external.invoice_scope = 'company'
            THEN 0
            ELSE external.patient_receivable_gross
       END::NUMERIC(12, 2) AS patient_receivable_gross,
       COALESCE(SUM(allocation.amount_gross) FILTER (
           WHERE allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'
             AND patient_invoice.status NOT IN ('draft', 'cancelled')
       ), 0)::NUMERIC(12, 2) AS allocated_receivable_gross,
       CASE WHEN external.invoice_scope = 'company'
            THEN 0
            ELSE GREATEST(
                external.patient_receivable_gross
                - COALESCE(SUM(allocation.amount_gross) FILTER (
                    WHERE allocation.reversed_at IS NULL
                      AND external.status <> 'cancelled'
                      AND patient_invoice.status NOT IN ('draft', 'cancelled')
                ), 0),
                0
            )
       END::NUMERIC(12, 2) AS remaining_receivable_gross
FROM external_invoices external
LEFT JOIN external_invoice_patient_invoice_allocations allocation
       ON allocation.external_invoice_id = external.id
LEFT JOIN invoices patient_invoice
       ON patient_invoice.id = allocation.patient_invoice_id
GROUP BY external.id, external.invoice_scope, external.patient_receivable_gross;

COMMENT ON COLUMN external_invoices.invoice_scope IS
    'patient_order for a patient/order cost; company for a supplier invoice addressed directly to GMED.';
COMMENT ON COLUMN external_invoices.supplier_name IS
    'Supplier name captured from the source invoice even when no provider directory entry is linked.';
